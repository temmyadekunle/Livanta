/**
 * The sync engine: pull remote changes, then push local ones.
 *
 * Deliberately boring and pull-based. Realtime is left out because a household
 * app that reconnects on every backgrounded tab is a support burden, and
 * syncing on focus, on mutation and on demand is enough for the handful of
 * devices a household actually uses.
 *
 * Every read and write is addressed to one explicit account store. The
 * anonymous database is never consulted: moving a device's signed-out data
 * into an account is an adoption decision that belongs to the user, not to a
 * background sync.
 *
 * Pull happens *before* push deliberately. After the merge, local state holds
 * the newest version of every record, so anything still newer than the cursor
 * is a genuine local edit; anything the remote won is re-sent unchanged, which
 * is harmless. The stricter guard lives in the SQL function, because this table
 * is the only copy of a user's data.
 *
 * Every call is guarded so that a failure, an offline device or a missing
 * configuration leaves IndexedDB exactly as it was. Sync is never a
 * precondition for using the app.
 */

import { LocalStore } from "../db.ts";
import { loadSettings, saveSettings } from "../settings.ts";
import type { Thing } from "../types.ts";
import { getSupabase, type Supabase } from "../supabase/client.ts";
import type { DismissalRow, SettingsRow, ThingRow } from "../supabase/types.ts";
import { mergeThings, shouldAcceptRemoteSettings, ts } from "./merge.ts";
import {
  SyncOwnershipError,
  syncOwner,
  type SyncOwner,
} from "./meta.ts";
import {
  rowToSettings,
  settingsToRow,
  thingToSyncPayload,
} from "./rows.ts";
import {
  accountStoreOwner,
  assertAccountStore,
  readSettingsFingerprint,
  readStoreSyncMeta,
  settingsFingerprint,
  writeSettingsFingerprint,
  writeStoreSyncMeta,
} from "./storeMeta.ts";

export type SyncPhase = "idle" | "syncing" | "done" | "error";

export interface SyncResult {
  pushed: number;
  pulled: number;
  removed: number;
  at: string;
}

export interface SyncOptions {
  /** The account database this cycle is allowed to read and write. */
  store: LocalStore;
  /** Fires when a pull changed local records, so the caller can re-render. */
  onChanged?: () => void;
  /** Injectable for tests; defaults to the shared client. */
  supabase?: Supabase | null;
}

const NOOP: SyncResult = { pushed: 0, pulled: 0, removed: 0, at: "" };

/**
 * Raised when the server did not confirm a queued deletion. The tombstone is
 * kept, so the next cycle retries rather than silently resurrecting the record.
 */
export class SyncConflictError extends Error {
  readonly thingIds: readonly string[];

  constructor(thingIds: readonly string[]) {
    super(
      `The server did not confirm deletion of: ${thingIds.join(", ")}. ` +
        "The deletion stays queued for the next sync.",
    );
    this.name = "SyncConflictError";
    this.thingIds = [...thingIds];
  }
}

/** The session owner, or null when signed out. Invalid ids are rejected. */
async function resolveSessionOwner(
  supabase: Supabase,
): Promise<SyncOwner | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return null;
  return syncOwner(userId);
}

/**
 * Refuses to continue when the session changed mid-cycle. Supabase applies the
 * session at request time, so a stale cycle must stop before issuing a write
 * that would land in the next account.
 */
async function requireOwner(
  supabase: Supabase,
  expected: SyncOwner,
): Promise<void> {
  const current = await resolveSessionOwner(supabase);
  if (!current || current.userId !== expected.userId) {
    throw new SyncOwnershipError(
      "The signed-in account changed during sync; stopping before the next write.",
    );
  }
}

/** Records changed after the cursor. A null cursor means "all of them". */
function isDirty(
  record: { updatedAt: string; createdAt: string },
  cursor: string | null,
): boolean {
  if (cursor === null) return true;
  return ts(record.updatedAt || record.createdAt) > ts(cursor);
}

/**
 * One full sync cycle for one account store. Returns zeroes when cloud sync is
 * unconfigured or the user is signed out, so callers can treat it as a no-op.
 *
 * A store that is anonymous, tampered with or owned by another account is
 * rejected before any network or local work happens. The cursor advances only
 * after every step succeeds, so an incomplete cycle is retried from the same
 * position.
 */
export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const { store, onChanged } = options;
  const owner = accountStoreOwner(store);

  const supabase =
    options.supabase === undefined ? getSupabase() : options.supabase;
  if (!supabase) return NOOP;

  const sessionOwner = await resolveSessionOwner(supabase);
  if (!sessionOwner) return NOOP;
  if (sessionOwner.userId !== owner.userId) {
    throw new SyncOwnershipError(
      "The signed-in account does not own this local store; sync was not started.",
    );
  }

  const meta = await readStoreSyncMeta(store, owner);
  const previousCursor = meta.cursor;
  const now = new Date().toISOString();
  let localChanged = false;

  try {
    const incoming = await pullThings(supabase, owner, store, meta);
    localChanged = incoming.changed > 0 || incoming.removed > 0;

    if (await pullSettings(supabase, owner, store, meta)) localChanged = true;
    if (await pullDismissals(supabase, owner, store, meta, previousCursor)) {
      localChanged = true;
    }

    const pushed = await pushThings(supabase, owner, store, meta);
    const pushedSettings = await pushSettings(supabase, owner, store, meta);
    await pushDismissals(supabase, owner, store, meta);

    // The session and the store are checked one last time before anything is
    // persisted, so a cycle that lost its account cannot advance the cursor.
    await requireOwner(supabase, owner);
    assertAccountStore(store, owner);

    if (pushedSettings !== null) {
      await writeSettingsFingerprint(store, owner, pushedSettings);
    }
    await writeStoreSyncMeta(
      store,
      { ...meta, cursor: now, seeded: true },
      owner,
    );

    if (localChanged) onChanged?.();
    return {
      pushed,
      pulled: incoming.changed,
      removed: incoming.removed,
      at: now,
    };
  } catch (error) {
    // A failed push can happen after a successful pull. Let the caller refresh
    // so the UI still shows what did arrive.
    if (localChanged) onChanged?.();
    throw error;
  }
}

interface IncomingThings {
  changed: number;
  removed: number;
}

async function pullThings(
  supabase: Supabase,
  owner: SyncOwner,
  store: LocalStore,
  meta: { cursor: string | null; tombstones: Record<string, string> },
): Promise<IncomingThings> {
  assertAccountStore(store, owner);
  await requireOwner(supabase, owner);

  let query = supabase
    .from("things")
    .select("*")
    .eq("user_id", owner.userId)
    .order("updated_at", { ascending: true });

  if (meta.cursor !== null) query = query.gt("updated_at", meta.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`Could not download things: ${error.message}`);

  // The response belongs to the session that issued the request, not
  // necessarily the one active now.
  await requireOwner(supabase, owner);
  assertAccountStore(store, owner);

  // A deletion still queued locally must not be undone by a pull. Tombstones
  // are only cleared once the server confirms them.
  const pendingDeletes = new Set(Object.keys(meta.tombstones));
  const rows = ((data ?? []) as ThingRow[]).filter(
    (row) => !pendingDeletes.has(row.id),
  );
  if (rows.length === 0) return { changed: 0, removed: 0 };

  const local = await store.getAllThings();
  const merged = mergeThings(local, rows);

  const deletedRemotely = new Set(
    rows.filter((row) => row.deleted_at).map((row) => row.id),
  );
  const kept = merged.filter((thing) => !deletedRemotely.has(thing.id));
  const keptIds = new Set(kept.map((thing) => thing.id));

  // Only touch records the merge actually changed, rather than rewriting the
  // user's whole history on every pull.
  const changed = kept.filter((thing) => {
    const before = local.find((item) => item.id === thing.id);
    return !before || before.updatedAt !== thing.updatedAt;
  });
  const removed = local.filter((thing) => !keptIds.has(thing.id));

  for (const thing of changed) await store.putThing(thing);
  for (const thing of removed) await store.deleteThing(thing.id);

  return { changed: changed.length, removed: removed.length };
}

async function pullSettings(
  supabase: Supabase,
  owner: SyncOwner,
  store: LocalStore,
  meta: { settingsUpdatedAt: string | null },
): Promise<boolean> {
  assertAccountStore(store, owner);
  await requireOwner(supabase, owner);

  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", owner.userId)
    .maybeSingle();

  if (error) throw new Error(`Could not download settings: ${error.message}`);
  await requireOwner(supabase, owner);
  if (!data) return false;

  const row = data as SettingsRow;
  if (!shouldAcceptRemoteSettings(meta.settingsUpdatedAt, row.updated_at)) {
    return false;
  }

  const settings = rowToSettings(row);
  assertAccountStore(store, owner);
  await saveSettings(store, settings);
  // Remember that this exact local state came from the server, so the push
  // half of the same cycle does not echo it straight back.
  await writeSettingsFingerprint(store, owner, settingsFingerprint(settings));
  meta.settingsUpdatedAt = row.updated_at;
  return true;
}

/**
 * Apply remote dismissal events. A row with `deleted_at` is an explicit restore
 * and must be applied as such; a missing row means nothing at all.
 */
async function pullDismissals(
  supabase: Supabase,
  owner: SyncOwner,
  store: LocalStore,
  meta: {
    pendingDismissals: Record<string, { dismissed: boolean; at: string }>;
  },
  previousCursor: string | null,
): Promise<boolean> {
  assertAccountStore(store, owner);
  await requireOwner(supabase, owner);

  let query = supabase
    .from("dismissals")
    .select("*")
    .eq("user_id", owner.userId);
  if (previousCursor !== null) {
    query = query.gt("dismissed_at", previousCursor);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not download dismissals: ${error.message}`);
  await requireOwner(supabase, owner);
  assertAccountStore(store, owner);

  const rows = (data ?? []) as DismissalRow[];
  if (rows.length === 0) return false;

  // Several rows can arrive for one alert; the newest event wins.
  const latest = new Map<string, DismissalRow>();
  for (const row of rows) {
    const existing = latest.get(row.alert_id);
    if (!existing || ts(row.dismissed_at) >= ts(existing.dismissed_at)) {
      latest.set(row.alert_id, row);
    }
  }

  const stored = await store.getAllAlerts();
  const byId = new Map(stored.map((alert) => [alert.id, alert]));
  let changed = false;

  for (const [alertId, row] of latest) {
    const pending = meta.pendingDismissals[alertId];
    // A newer unsent local change is not overwritten by an older remote event.
    if (pending && ts(pending.at) > ts(row.dismissed_at)) continue;

    if (pending) delete meta.pendingDismissals[alertId];

    const alert = byId.get(alertId);
    if (!alert) continue;

    const dismissed = row.deleted_at === null;
    if (alert.dismissed === dismissed) continue;

    const updated = { ...alert, dismissed };
    await store.putAlert(updated);
    byId.set(alertId, updated);
    changed = true;
  }

  return changed;
}

/** Rows for a thing that was deleted locally, replayed as a tombstone. */
function tombstonePayload(id: string, deletedAt: string): Record<string, unknown> {
  return {
    id,
    name: "",
    category: "home",
    kind: "reminder",
    amount: null,
    currency: "NGN",
    due_date: null,
    last_handled_date: null,
    recurrence: null,
    service_interval_days: null,
    status: "archived",
    priority: "routine",
    notes: null,
    details: {},
    created_at: deletedAt,
    updated_at: deletedAt,
    deleted_at: deletedAt,
  };
}

/**
 * Confirm that the server row is actually deleted. The RPC cannot report which
 * rows its `where` clause rejected, so the only trustworthy check is to read
 * the rows back. An unconfirmed tombstone stays queued and fails the cycle.
 */
async function confirmTombstones(
  supabase: Supabase,
  owner: SyncOwner,
  tombstones: [string, string][],
): Promise<void> {
  if (tombstones.length === 0) return;

  await requireOwner(supabase, owner);
  const ids = tombstones.map(([id]) => id);

  const { data, error } = await supabase
    .from("things")
    .select("id, deleted_at")
    .eq("user_id", owner.userId)
    .in("id", ids);
  if (error) {
    throw new Error(`Could not confirm deletion: ${error.message}`);
  }
  await requireOwner(supabase, owner);

  const deleted = new Set(
    ((data ?? []) as Pick<ThingRow, "id" | "deleted_at">[])
      .filter((row) => row.deleted_at)
      .map((row) => row.id),
  );
  const pending = ids.filter((id) => !deleted.has(id));
  if (pending.length > 0) throw new SyncConflictError(pending);
}

async function pushThings(
  supabase: Supabase,
  owner: SyncOwner,
  store: LocalStore,
  meta: { cursor: string | null; tombstones: Record<string, string> },
): Promise<number> {
  assertAccountStore(store, owner);
  await requireOwner(supabase, owner);
  const local = await store.getAllThings();
  const dirty = local.filter((thing) => isDirty(thing, meta.cursor));

  // A local delete removes the record from IndexedDB outright, so deletions are
  // replayed from the tombstone map instead of the things store.
  const tombstones = Object.entries(meta.tombstones);
  if (dirty.length === 0 && tombstones.length === 0) return 0;

  const payload = [
    ...dirty.map((thing: Thing) => thingToSyncPayload(thing)),
    ...tombstones.map(([id, deletedAt]) => tombstonePayload(id, deletedAt)),
  ];

  await requireOwner(supabase, owner);

  // The WHERE clause inside the SQL function is the conflict rule, so a device
  // with a skewed clock cannot overwrite newer data.
  const { error } = await supabase.rpc("upsert_things_sync", { rows: payload });
  if (error) throw new Error(`Could not upload things: ${error.message}`);

  await confirmTombstones(supabase, owner, tombstones);

  // Only confirmed tombstones are forgotten; a rejected deletion stays queued.
  for (const [id] of tombstones) delete meta.tombstones[id];
  return payload.length;
}

/**
 * Push settings only when they differ from the last state this account pushed
 * or accepted. Returns the fingerprint to persist once the whole cycle has
 * completed, or null when nothing needed sending.
 */
async function pushSettings(
  supabase: Supabase,
  owner: SyncOwner,
  store: LocalStore,
  meta: { settingsUpdatedAt: string | null },
): Promise<string | null> {
  assertAccountStore(store, owner);
  await requireOwner(supabase, owner);
  const settings = await loadSettings(store);
  const fingerprint = settingsFingerprint(settings);

  if ((await readSettingsFingerprint(store, owner)) === fingerprint) {
    return null;
  }

  const now = new Date().toISOString();
  await requireOwner(supabase, owner);

  const { error } = await supabase
    .from("settings")
    .upsert(settingsToRow(settings, owner.userId, now), {
      onConflict: "user_id",
    });
  if (error) throw new Error(`Could not upload settings: ${error.message}`);

  meta.settingsUpdatedAt = now;
  return fingerprint;
}

async function pushDismissals(
  supabase: Supabase,
  owner: SyncOwner,
  store: LocalStore,
  meta: {
    pendingDismissals: Record<string, { dismissed: boolean; at: string }>;
  },
): Promise<void> {
  assertAccountStore(store, owner);
  const pending = Object.entries(meta.pendingDismissals);
  if (pending.length === 0) return;

  const rows = pending.map(([alert_id, entry]) => ({
    user_id: owner.userId,
    alert_id,
    dismissed_at: entry.at,
    deleted_at: entry.dismissed ? null : entry.at,
  }));

  await requireOwner(supabase, owner);

  const { error } = await supabase
    .from("dismissals")
    .upsert(rows, { onConflict: "user_id,alert_id" });
  if (error) throw new Error(`Could not upload dismissals: ${error.message}`);

  meta.pendingDismissals = {};
}

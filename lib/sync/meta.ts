/**
 * Local sync bookkeeping, kept out of the Settings object so that enabling sync
 * never changes what the user sees in their profile.
 *
 * Stored in the existing IndexedDB `settings` store under reserved keys, so it
 * needs no schema migration and survives alongside everything else.
 *
 * Bookkeeping belongs to an account. The legacy key is the device-level record
 * used by signed-out mutations and is never rewritten by an account sync.
 * Account records live under a key namespaced by the validated user id and
 * carry an `ownerId` stamp, so one account cannot read, reuse or overwrite
 * another account's cursor, tombstones or pending dismissals.
 */

import {
  anonymousStore,
  databaseNameForScope,
  getSetting,
  isValidUserId,
  LocalStore,
  putSetting,
} from "../db.ts";

export const SYNC_META_KEY = "__livanta_sync_meta";

/**
 * Device-level marker naming the one account allowed to sync the anonymous
 * `lifedesk` dataset. Kept separate from per-account bookkeeping because the
 * anonymous data itself has no owner until an account claims it.
 */
export const SYNC_DATA_OWNER_KEY = "__livanta_sync_data_owner";

/** A validated, lower-case Supabase user id. */
export interface SyncOwner {
  readonly userId: string;
}

/** Raised when bookkeeping is addressed by the wrong account. */
export class SyncOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncOwnershipError";
  }
}

export interface SyncMeta {
  /** Owning account, or null for the device-level legacy record. */
  ownerId: string | null;
  /** Highest updated_at covered by a completed sync. */
  cursor: string | null;
  /** updated_at of the local settings row last pushed. */
  settingsUpdatedAt: string | null;
  /** thingId -> deletion time, for local deletes awaiting propagation. */
  tombstones: Record<string, string>;
  /** alertId -> state, for dismissal changes awaiting push. */
  pendingDismissals: Record<string, { dismissed: boolean; at: string }>;
  /** True once a full cycle has run, so local data is known to be uploaded. */
  seeded: boolean;
}

export const EMPTY_SYNC_META: SyncMeta = {
  ownerId: null,
  cursor: null,
  settingsUpdatedAt: null,
  tombstones: {},
  pendingDismissals: {},
  seeded: false,
};

/** Builds a validated owner, rejecting anything that is not a Supabase UUID. */
export function syncOwner(userId: string): SyncOwner {
  if (!isValidUserId(userId)) {
    throw new SyncOwnershipError(
      "Sync bookkeeping requires a valid Supabase user id.",
    );
  }
  return Object.freeze({ userId: userId.toLowerCase() });
}

function normalizeOwner(owner: SyncOwner | null): SyncOwner | null {
  return owner ? syncOwner(owner.userId) : null;
}

/** The legacy device key, or an account-namespaced key. */
export function syncMetaKey(owner: SyncOwner | null): string {
  const normalized = normalizeOwner(owner);
  return normalized
    ? `${SYNC_META_KEY}:user:${normalized.userId}`
    : SYNC_META_KEY;
}

export function emptySyncMeta(owner: SyncOwner | null = null): SyncMeta {
  const normalized = normalizeOwner(owner);
  return {
    ...EMPTY_SYNC_META,
    ownerId: normalized?.userId ?? null,
    tombstones: {},
    pendingDismissals: {},
  };
}

function coerce(raw: unknown, owner: SyncOwner | null): SyncMeta {
  const empty = emptySyncMeta(owner);
  if (!raw || typeof raw !== "object") return empty;

  const value = raw as Partial<SyncMeta>;
  if (
    value.ownerId !== undefined &&
    value.ownerId !== null &&
    typeof value.ownerId !== "string"
  ) {
    throw new SyncOwnershipError(
      "Sync bookkeeping has an invalid account stamp.",
    );
  }

  const storedOwner =
    typeof value.ownerId === "string" ? value.ownerId.toLowerCase() : null;
  const expectedOwner = empty.ownerId;
  if (storedOwner !== expectedOwner) {
    throw new SyncOwnershipError(
      "Sync bookkeeping belongs to a different account; refusing to reuse it.",
    );
  }

  return {
    ownerId: expectedOwner,
    cursor: typeof value.cursor === "string" ? value.cursor : null,
    settingsUpdatedAt:
      typeof value.settingsUpdatedAt === "string" ? value.settingsUpdatedAt : null,
    tombstones:
      value.tombstones && typeof value.tombstones === "object" ? value.tombstones : {},
    pendingDismissals:
      value.pendingDismissals && typeof value.pendingDismissals === "object"
        ? value.pendingDismissals
        : {},
    seeded: value.seeded === true,
  };
}

export async function readSyncMeta(
  owner: SyncOwner | null = null,
): Promise<SyncMeta> {
  return readStoreMeta(anonymousStore, owner);
}

async function readStoreMeta(store: LocalStore, owner: SyncOwner | null): Promise<SyncMeta> {
  const normalized = normalizeOwner(owner);
  return coerce(await store.getSetting<SyncMeta>(syncMetaKey(normalized)), normalized);
}

export async function writeSyncMeta(
  meta: SyncMeta,
  owner: SyncOwner | null = null,
): Promise<void> {
  await writeStoreMeta(anonymousStore, meta, owner);
}

async function writeStoreMeta(
  store: LocalStore,
  meta: SyncMeta,
  owner: SyncOwner | null,
): Promise<void> {
  const normalized = normalizeOwner(owner);
  const expectedOwner = normalized?.userId ?? null;
  if ((meta.ownerId ?? null) !== expectedOwner) {
    throw new SyncOwnershipError(
      "Refusing to store sync bookkeeping under a different account.",
    );
  }
  await store.putSetting(syncMetaKey(normalized), { ...meta, ownerId: expectedOwner });
}

function parseDataOwner(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") {
    throw new SyncOwnershipError("The local data ownership record is invalid.");
  }
  const ownerId = (raw as { ownerId?: unknown }).ownerId;
  if (typeof ownerId !== "string" || !isValidUserId(ownerId)) {
    throw new SyncOwnershipError("The local data ownership record is invalid.");
  }
  return ownerId.toLowerCase();
}

/** The account that claimed the anonymous dataset, if any. */
export async function readLocalDataOwner(): Promise<string | null> {
  return parseDataOwner(await getSetting<unknown>(SYNC_DATA_OWNER_KEY));
}

/**
 * Claims the device's anonymous dataset for `owner` on first sync, and refuses
 * every other account afterwards.
 *
 * Per-account bookkeeping alone is not enough: a second account would see an
 * empty cursor and upload this device's anonymous records into its own cloud
 * account. The claim makes that upload a deliberate Stage 3 adoption step
 * instead of an automatic leak. No local record is copied or migrated; only the
 * deletion intents the device already queued pass to the account that owns them.
 */
export async function ensureLocalDataOwner(owner: SyncOwner): Promise<void> {
  const normalized = syncOwner(owner.userId);
  const current = await readLocalDataOwner();
  if (current !== null) {
    if (current !== normalized.userId) {
      throw new SyncOwnershipError(
        "The local data on this device belongs to a different account; it needs an explicit adoption step before it can sync.",
      );
    }
    return;
  }

  // Deletes queued before the claim describe this dataset, so they pass to the
  // account about to own it. Only that local queue moves: cursor, settings
  // timestamp and seeded flag describe remote state and stay with whatever
  // record already holds them.
  const legacy = await readSyncMeta(null);
  const existing = await readSyncMeta(normalized);
  await writeSyncMeta(
    {
      ...existing,
      tombstones: { ...legacy.tombstones, ...existing.tombstones },
      pendingDismissals: {
        ...legacy.pendingDismissals,
        ...existing.pendingDismissals,
      },
    },
    normalized,
  );

  await putSetting(SYNC_DATA_OWNER_KEY, { ownerId: normalized.userId });

  // Re-read so a racing tab that claimed it first wins over this one.
  const settled = await readLocalDataOwner();
  if (settled !== normalized.userId) {
    throw new SyncOwnershipError(
      "The local data on this device was claimed by another account.",
    );
  }
}

/**
 * Where a mutation's bookkeeping belongs. A signed-out edit is queued for the
 * account that already claimed this device's data, because no other account may
 * sync it; an unclaimed device keeps the legacy device record. A damaged claim
 * must never break a local edit, so it falls back to the legacy record, which
 * account sync never reads.
 */
async function mutationOwner(owner: SyncOwner | null): Promise<SyncOwner | null> {
  if (owner) return owner;
  try {
    const claimed = await readLocalDataOwner();
    return claimed ? syncOwner(claimed) : null;
  } catch {
    return null;
  }
}

let activeOwner: SyncOwner | null = null;

/**
 * Binds the owner used by mutation bookkeeping. An invalid id clears the
 * binding rather than throwing: a malformed session must not break the
 * offline app, and clearing is the safe default.
 */
export function bindSyncOwner(
  userId: string | null | undefined,
): SyncOwner | null {
  if (!userId || !isValidUserId(userId)) {
    activeOwner = null;
    return null;
  }
  activeOwner = syncOwner(userId);
  return activeOwner;
}

export function getSyncOwner(): SyncOwner | null {
  return activeOwner;
}

/** Clears the binding only if it still belongs to `owner`. */
export function releaseSyncOwner(owner: SyncOwner | null): void {
  if (!owner || !isValidUserId(owner.userId)) return;
  if (activeOwner?.userId === owner.userId.toLowerCase()) activeOwner = null;
}

/**
 * Record a local deletion so it can be propagated as a tombstone.
 *
 * Lives here rather than in sync/engine.ts so that the core data hook can
 * record changes without importing the Supabase SDK at all. That keeps the
 * signed-out, offline-only path free of the cloud client. The record follows the
 * signed-in account, or the account that claimed this device when signed out,
 * so it is never uploaded for a different one.
 */
export function recordDeletion(thingId: string, owner?: SyncOwner | null): Promise<void>;
export function recordDeletion(store: LocalStore, thingId: string, owner?: SyncOwner | null): Promise<void>;
export async function recordDeletion(
  storeOrId: LocalStore | string,
  idOrOwner?: string | SyncOwner | null,
  owner?: SyncOwner | null,
): Promise<void> {
  const legacy = typeof storeOrId === "string";
  const store = legacy ? anonymousStore : storeOrId;
  const thingId = legacy ? storeOrId : idOrOwner as string;
  const target = legacy
    ? await mutationOwner(idOrOwner === undefined ? getSyncOwner() : idOrOwner as SyncOwner | null)
    : await storeMutationOwner(store, owner);
  const meta = await readStoreMeta(store, target);
  meta.tombstones = { ...meta.tombstones, [thingId]: new Date().toISOString() };
  await writeStoreMeta(store, meta, target);
}

/** Record a dismissal change so it can be propagated. */
export function recordDismissal(alertId: string, dismissed: boolean, owner?: SyncOwner | null): Promise<void>;
export function recordDismissal(store: LocalStore, alertId: string, dismissed: boolean, owner?: SyncOwner | null): Promise<void>;
export async function recordDismissal(
  storeOrId: LocalStore | string,
  idOrDismissed: string | boolean,
  dismissedOrOwner?: boolean | SyncOwner | null,
  owner?: SyncOwner | null,
): Promise<void> {
  const legacy = typeof storeOrId === "string";
  const store = legacy ? anonymousStore : storeOrId;
  const alertId = legacy ? storeOrId : idOrDismissed as string;
  const dismissed = legacy ? idOrDismissed as boolean : dismissedOrOwner as boolean;
  const target = legacy
    ? await mutationOwner(dismissedOrOwner === undefined ? getSyncOwner() : dismissedOrOwner as SyncOwner | null)
    : await storeMutationOwner(store, owner);
  const meta = await readStoreMeta(store, target);
  meta.pendingDismissals = {
    ...meta.pendingDismissals,
    [alertId]: { dismissed, at: new Date().toISOString() },
  };
  await writeStoreMeta(store, meta, target);
}

// Account stores derive ownership from their scope, never the ambient binding.
async function storeMutationOwner(
  store: LocalStore,
  owner: SyncOwner | null | undefined,
): Promise<SyncOwner | null> {
  if (!(store instanceof LocalStore) || store.databaseName !== databaseNameForScope(store.scope)) {
    throw new SyncOwnershipError("Mutation bookkeeping requires a valid LocalStore.");
  }
  const supplied = owner === undefined || owner === null ? owner : syncOwner(owner.userId);
  if (store.scope.kind === "user") {
    const scoped = syncOwner(store.scope.userId);
    if (supplied !== undefined && supplied?.userId !== scoped.userId) {
      throw new SyncOwnershipError("The bookkeeping owner does not match the account store.");
    }
    return scoped;
  }

  const target = supplied === undefined ? getSyncOwner() : supplied;
  const claimed = parseDataOwner(await store.getSetting<unknown>(SYNC_DATA_OWNER_KEY));
  if (claimed && target && claimed !== target.userId) {
    throw new SyncOwnershipError("The bookkeeping owner does not match the local data claim.");
  }
  return claimed ? syncOwner(claimed) : target;
}

/** Forget sync bookkeeping so the next sync re-uploads local state in full. */
export async function resetSyncMeta(
  owner: SyncOwner | null = getSyncOwner(),
): Promise<void> {
  await writeSyncMeta(emptySyncMeta(owner), owner);
}

/**
 * Account-store sync engine.
 *
 * Every test uses a fake-indexeddb database per account and a fake Supabase
 * client, so the assertions are about where bytes land rather than about a
 * live project. The anonymous database is seeded in several tests and then
 * watched: a cycle must never read it, claim it or upload it.
 */

import test from "node:test";

import type { LocalStore } from "../lib/db.ts";
import type { SyncMeta, SyncOwner } from "../lib/sync/meta.ts";
import type { Supabase } from "../lib/supabase/client.ts";
import type {
  DismissalRow,
  SettingsRow,
  ThingRow,
} from "../lib/supabase/types.ts";
import { assert, makeAlert, makeThing } from "./helpers.ts";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, {
    value,
    writable: true,
    configurable: true,
  });

const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
define("IDBKeyRange", IDBKeyRange);
define("indexedDB", indexedDB);

const {
  anonymousStore,
  clearAllStores,
  closeScope,
  createLocalStore,
  userScope,
} = await import("../lib/db.ts");

const {
  bindSyncOwner,
  emptySyncMeta,
  readLocalDataOwner,
  recordDeletion,
  recordDismissal,
  syncMetaKey,
  syncOwner,
  SyncOwnershipError,
  SYNC_DATA_OWNER_KEY,
} = await import("../lib/sync/meta.ts");

/** The per-account metadata key, wherever the account store keeps it. */
const SYNC_META_KEY_FOR = syncMetaKey;

const {
  readStoreSyncMeta,
  writeStoreSyncMeta,
} = await import("../lib/sync/storeMeta.ts");

const { runSync, SyncConflictError } = await import("../lib/sync/engine.ts");
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import(
  "../lib/settings.ts"
);
const { settingsToRow } = await import("../lib/sync/rows.ts");

let ownerCounter = 0;

function newOwner(): SyncOwner {
  ownerCounter += 1;
  return syncOwner(
    `10000000-0000-4000-8000-${String(ownerCounter).padStart(12, "0")}`,
  );
}

const stores: LocalStore[] = [];

function account(): { store: LocalStore; owner: SyncOwner } {
  const owner = newOwner();
  const store = createLocalStore(userScope(owner.userId));
  stores.push(store);
  return { store, owner };
}

test.beforeEach(async () => {
  bindSyncOwner(null);
  await clearAllStores();
});

test.after(async () => {
  bindSyncOwner(null);
  for (const store of [...stores, anonymousStore]) {
    await closeScope(store.scope);
  }
});

/** A complete remote row; override only the fields a test cares about. */
function remoteThing(
  userId: string,
  overrides: Partial<ThingRow> & { id: string },
): ThingRow {
  return {
    user_id: userId,
    name: "Remote thing",
    category: "home",
    kind: "reminder",
    amount: null,
    currency: "NGN",
    due_date: null,
    last_handled_date: null,
    recurrence: null,
    service_interval_days: null,
    status: "active",
    priority: "routine",
    notes: null,
    details: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

interface FakeSession {
  user: { id: string };
}

interface FakeSeed {
  things?: ThingRow[];
  settings?: SettingsRow | null;
  dismissals?: DismissalRow[];
}

type Row = Record<string, unknown>;

/**
 * A minimal Supabase stand-in with just enough fidelity for the engine:
 * sequential sessions, filtered selects, settings/dismissals upserts and the
 * things RPC, whose `where` guard is reproduced so conflicts behave like the
 * real function.
 */
function fakeClient(
  sessions: (FakeSession | null)[],
  seed: FakeSeed = {},
) {
  const remoteThings = new Map<string, ThingRow>(
    (seed.things ?? []).map((row) => [row.id, { ...row }]),
  );
  let remoteSettings: SettingsRow | null = seed.settings ?? null;
  const remoteDismissals = new Map<string, DismissalRow>(
    (seed.dismissals ?? []).map((row) => [row.alert_id, { ...row }]),
  );

  const calls = {
    rpc: 0,
    settingsUpserts: 0,
    dismissalUpserts: 0,
    sessions: 0,
    filters: [] as string[],
    rpcRows: [] as Row[],
    settingsRows: [] as SettingsRow[],
    dismissalRows: [] as DismissalRow[],
  };

  let sessionCall = 0;
  let lastUserId: string | null = null;

  const nextSession = () => {
    const value =
      sessions[Math.min(sessionCall, sessions.length - 1)] ?? null;
    sessionCall += 1;
    calls.sessions += 1;
    lastUserId = value?.user.id ?? null;
    return value;
  };

  const buildQuery = (table: string) => {
    const eqs: [string, unknown][] = [];
    const gts: [string, string][] = [];
    const ins: [string, readonly unknown[]][] = [];

    const allRows = (): Row[] => {
      if (table === "things") return [...remoteThings.values()] as unknown as Row[];
      if (table === "dismissals") {
        return [...remoteDismissals.values()] as unknown as Row[];
      }
      return remoteSettings ? [remoteSettings as unknown as Row] : [];
    };

    const apply = (rows: Row[]) =>
      rows.filter(
        (row) =>
          eqs.every(([column, value]) => row[column] === value) &&
          gts.every(
            ([column, value]) => String(row[column] ?? "") > value,
          ) &&
          ins.every(([column, values]) => values.includes(row[column])),
      );

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        calls.filters.push(`${column}=${String(value)}`);
        eqs.push([column, value]);
        return builder;
      },
      order: () => builder,
      gt: (column: string, value: string) => {
        gts.push([column, value]);
        return builder;
      },
      in: (column: string, values: readonly unknown[]) => {
        ins.push([column, values]);
        return builder;
      },
      maybeSingle: async () => {
        const rows = apply(allRows());
        return { data: rows[0] ?? null, error: null };
      },
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({ data: apply(allRows()), error: null }).then(
          resolve,
          reject,
        ),
    };
    return builder;
  };

  const client = {
    auth: {
      getSession: async () => {
        const session = nextSession();
        return { data: { session }, error: null };
      },
    },
    from: (table: string) => ({
      select: () => buildQuery(table),
      upsert: async (payload: unknown) => {
        if (table === "settings") {
          calls.settingsUpserts += 1;
          calls.settingsRows.push(payload as SettingsRow);
          remoteSettings = payload as SettingsRow;
        } else if (table === "dismissals") {
          calls.dismissalUpserts += 1;
          for (const row of payload as DismissalRow[]) {
            calls.dismissalRows.push(row);
            remoteDismissals.set(row.alert_id, { ...row });
          }
        }
        return { error: null };
      },
    }),
    rpc: async (_name: string, args?: { rows?: Row[] }) => {
      calls.rpc += 1;
      const payload = args?.rows ?? [];
      calls.rpcRows.push(...payload);

      for (const row of payload) {
        const id = String(row.id);
        const current = remoteThings.get(id);
        if (
          !current ||
          String(row.updated_at ?? "") > String(current.updated_at ?? "")
        ) {
          remoteThings.set(id, {
            ...(current ?? {}),
            ...row,
            user_id: lastUserId ?? current?.user_id ?? "",
          } as unknown as ThingRow);
        }
      }
      return { error: null };
    },
  };

  return { client: client as unknown as Supabase, calls, remoteThings };
}

test("a cycle reads and writes only the explicit account store", async (t) => {
  const a = account();
  const b = account();

  const anonymousThing = makeThing({ id: "anonymous-thing" });
  await anonymousStore.putThing(anonymousThing);
  await anonymousStore.putSetting(SYNC_META_KEY_FOR(a.owner), {
    ...emptySyncMeta(a.owner),
    cursor: "legacy-cursor",
    tombstones: { "anonymous-gone": "2026-01-02T00:00:00.000Z" },
    seeded: true,
  });
  await anonymousStore.putSetting(SYNC_DATA_OWNER_KEY, {
    ownerId: b.owner.userId,
  });

  await a.store.putThing(makeThing({ id: "a-thing" }));
  await b.store.putThing(makeThing({ id: "b-thing" }));
  await saveSettings(a.store, { ...DEFAULT_SETTINGS, displayName: "A" });
  await saveSettings(b.store, { ...DEFAULT_SETTINGS, displayName: "B" });

  const { client, calls } = fakeClient([{ user: { id: a.owner.userId } }]);

  const readMeta = t.mock.method(anonymousStore, "getSetting", () => {
    throw new Error("anonymous metadata read");
  });
  const writeMeta = t.mock.method(anonymousStore, "putSetting", () => {
    throw new Error("anonymous metadata write");
  });
  const readThings = t.mock.method(anonymousStore, "getAllThings", () => {
    throw new Error("anonymous things read");
  });
  const writeThings = t.mock.method(anonymousStore, "putThing", () => {
    throw new Error("anonymous things write");
  });
  const readAlerts = t.mock.method(anonymousStore, "getAllAlerts", () => {
    throw new Error("anonymous alerts read");
  });
  const writeAlerts = t.mock.method(anonymousStore, "putAlert", () => {
    throw new Error("anonymous alerts write");
  });

  const result = await runSync({ store: a.store, supabase: client });

  assert.equal(result.pushed, 1);
  assert.deepEqual(
    calls.rpcRows.map((row) => row.id),
    ["a-thing"],
  );
  assert.equal(
    calls.filters.every((entry) => entry === `user_id=${a.owner.userId}`),
    true,
  );
  assert.equal(calls.settingsRows.length, 1);
  assert.equal(calls.settingsRows[0].user_id, a.owner.userId);
  assert.equal(calls.settingsRows[0].display_name, "A");

  for (const mock of [
    readMeta,
    writeMeta,
    readThings,
    writeThings,
    readAlerts,
    writeAlerts,
  ]) {
    assert.equal(mock.mock.callCount(), 0);
  }

  const meta = await readStoreSyncMeta(a.store, a.owner);
  assert.equal(meta.ownerId, a.owner.userId);
  assert.equal(meta.seeded, true);
  assert.equal(typeof meta.cursor, "string");

  assert.equal((await b.store.getAllThings())[0].id, "b-thing");
  assert.equal((await loadSettings(b.store)).displayName, "B");
  assert.equal(await b.store.getSetting(SYNC_META_KEY_FOR(b.owner)), null);

  t.mock.restoreAll();

  assert.deepEqual(await anonymousStore.getAllThings(), [anonymousThing]);
  const legacy = await anonymousStore.getSetting<SyncMeta>(
    SYNC_META_KEY_FOR(a.owner),
  );
  assert.equal(legacy?.cursor, "legacy-cursor");
  assert.deepEqual(legacy?.tombstones, {
    "anonymous-gone": "2026-01-02T00:00:00.000Z",
  });
  assert.equal(await readLocalDataOwner(), b.owner.userId);
});

test("an anonymous store is refused before any remote or local work", async () => {
  const { owner } = account();
  const anonymousThing = makeThing({ id: "anonymous-thing" });
  await anonymousStore.putThing(anonymousThing);

  let remoteCalls = 0;
  const forbidden = () => {
    remoteCalls += 1;
    throw new Error("network must not run");
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: owner.userId } } } }),
    },
    from: forbidden,
    rpc: forbidden,
  } as unknown as Supabase;

  await assert.rejects(
    runSync({ store: anonymousStore, supabase: client }),
    SyncOwnershipError,
  );
  assert.equal(remoteCalls, 0);
  assert.deepEqual(await anonymousStore.getAllThings(), [anonymousThing]);
  assert.equal(await readLocalDataOwner(), null);

  const tampered = account();
  Object.defineProperty(tampered.store, "databaseName", {
    value: "lifedesk",
  });
  await assert.rejects(
    runSync({ store: tampered.store, supabase: client }),
    SyncOwnershipError,
  );
  assert.equal(remoteCalls, 0);
});

test("a store owned by another account is refused before the network", async () => {
  const a = account();
  const b = account();
  await b.store.putThing(makeThing({ id: "b-thing" }));

  let remoteCalls = 0;
  const forbidden = () => {
    remoteCalls += 1;
    throw new Error("network must not run");
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: a.owner.userId } } } }),
    },
    from: forbidden,
    rpc: forbidden,
  } as unknown as Supabase;

  await assert.rejects(
    runSync({ store: b.store, supabase: client }),
    SyncOwnershipError,
  );
  assert.equal(remoteCalls, 0);
  assert.equal((await b.store.getAllThings())[0].id, "b-thing");
  assert.equal(await b.store.getSetting(SYNC_META_KEY_FOR(b.owner)), null);
});

test("a signed-out session does not open the store", async (t) => {
  const { store } = account();
  const read = t.mock.method(store, "getSetting", () => {
    throw new Error("store read");
  });
  const things = t.mock.method(store, "getAllThings", () => {
    throw new Error("store read");
  });
  const { client, calls } = fakeClient([null]);

  const result = await runSync({ store, supabase: client });

  assert.deepEqual(result, { pushed: 0, pulled: 0, removed: 0, at: "" });
  assert.equal(calls.rpc, 0);
  assert.equal(calls.filters.length, 0);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(things.mock.callCount(), 0);
});

test("a session change during the pull writes nothing and keeps the cursor", async () => {
  const a = account();
  const b = account();
  const cursor = "2026-12-01T00:00:00.000Z";
  await writeStoreSyncMeta(
    a.store,
    { ...emptySyncMeta(a.owner), cursor, seeded: true },
    a.owner,
  );

  const localThing = makeThing({
    id: "local-thing",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  await a.store.putThing(localThing);

  const { client, calls } = fakeClient(
    [
      { user: { id: a.owner.userId } },
      { user: { id: a.owner.userId } },
      { user: { id: b.owner.userId } },
    ],
    {
      things: [
        remoteThing(a.owner.userId, {
          id: "remote-thing",
          updated_at: "2027-01-01T00:00:00.000Z",
        }),
      ],
    },
  );

  let changes = 0;
  await assert.rejects(
    runSync({
      store: a.store,
      supabase: client,
      onChanged: () => {
        changes += 1;
      },
    }),
    SyncOwnershipError,
  );

  assert.equal(changes, 0);
  assert.deepEqual(await a.store.getAllThings(), [localThing]);
  assert.deepEqual(await readStoreSyncMeta(a.store, a.owner), {
    ...emptySyncMeta(a.owner),
    cursor,
    seeded: true,
  });
  assert.equal(calls.rpc, 0);
  assert.equal(calls.settingsUpserts, 0);
  assert.deepEqual(await b.store.getAllThings(), []);
});

test("metadata stamped for another account blocks the cycle", async () => {
  const a = account();
  const b = account();
  await a.store.putSetting(SYNC_META_KEY_FOR(a.owner), {
    ...emptySyncMeta(a.owner),
    ownerId: b.owner.userId,
  });

  let remoteCalls = 0;
  const forbidden = () => {
    remoteCalls += 1;
    throw new Error("network must not run");
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: a.owner.userId } } } }),
    },
    from: forbidden,
    rpc: forbidden,
  } as unknown as Supabase;

  await assert.rejects(
    runSync({ store: a.store, supabase: client }),
    SyncOwnershipError,
  );
  assert.equal(remoteCalls, 0);
});

test("settings are pushed once and only after they change", async () => {
  const { store, owner } = account();
  await saveSettings(store, { ...DEFAULT_SETTINGS, displayName: "First" });
  const { client, calls } = fakeClient([{ user: { id: owner.userId } }]);

  const first = await runSync({ store, supabase: client });
  assert.equal(first.pushed, 0);
  assert.equal(calls.settingsUpserts, 1);
  assert.equal(calls.settingsRows[0].display_name, "First");

  const firstMeta = await readStoreSyncMeta(store, owner);
  assert.equal(firstMeta.seeded, true);
  assert.equal(typeof firstMeta.cursor, "string");

  await runSync({ store, supabase: client });
  assert.equal(calls.settingsUpserts, 1);

  await saveSettings(store, { ...DEFAULT_SETTINGS, displayName: "Second" });
  await runSync({ store, supabase: client });
  assert.equal(calls.settingsUpserts, 2);
  assert.equal(calls.settingsRows[1].display_name, "Second");

  const meta = await readStoreSyncMeta(store, owner);
  assert.equal(meta.ownerId, owner.userId);
  assert.equal(meta.seeded, true);
});

test("remote settings are applied and not echoed back", async () => {
  const { store, owner } = account();
  const remote = settingsToRow(
    { ...DEFAULT_SETTINGS, displayName: "From elsewhere" },
    owner.userId,
    "2026-05-01T00:00:00.000Z",
  );
  const { client, calls } = fakeClient(
    [{ user: { id: owner.userId } }],
    { settings: remote },
  );

  let changes = 0;
  await runSync({
    store,
    supabase: client,
    onChanged: () => {
      changes += 1;
    },
  });

  assert.equal(calls.settingsUpserts, 0);
  assert.equal((await loadSettings(store)).displayName, "From elsewhere");
  assert.equal(changes, 1);

  const meta = await readStoreSyncMeta(store, owner);
  assert.equal(meta.settingsUpdatedAt, remote.updated_at);

  await runSync({ store, supabase: client });
  assert.equal(calls.settingsUpserts, 0);
});

test("a queued deletion is not undone by the pull that follows it", async () => {
  const { store, owner } = account();
  await store.putThing(makeThing({ id: "gone" }));
  await recordDeletion(store, "gone");
  await store.deleteThing("gone");

  const { client, calls } = fakeClient(
    [{ user: { id: owner.userId } }],
    {
      things: [
        remoteThing(owner.userId, {
          id: "gone",
          updated_at: "2026-01-01T00:00:00.000Z",
        }),
      ],
    },
  );

  await runSync({ store, supabase: client });

  assert.deepEqual(await store.getAllThings(), []);
  const pushed = calls.rpcRows.find((row) => row.id === "gone");
  assert.equal(typeof pushed?.deleted_at, "string");
  assert.equal(
    calls.filters.every((entry) => entry === `user_id=${owner.userId}`),
    true,
  );
});

test("a tombstone stays queued until the server confirms it", async () => {
  const { store, owner } = account();
  await store.putThing(makeThing({ id: "gone" }));
  await recordDeletion(store, "gone");
  await store.deleteThing("gone");

  const { client, calls, remoteThings } = fakeClient(
    [{ user: { id: owner.userId } }],
    {
      things: [
        remoteThing(owner.userId, {
          id: "gone",
          updated_at: "2030-01-01T00:00:00.000Z",
        }),
      ],
    },
  );

  await assert.rejects(
    runSync({ store, supabase: client }),
    (error) =>
      error instanceof SyncConflictError &&
      error.thingIds.includes("gone"),
  );

  const conflicted = await readStoreSyncMeta(store, owner);
  assert.equal(typeof conflicted.tombstones.gone, "string");
  assert.equal(conflicted.cursor, null);
  assert.equal(conflicted.seeded, false);
  assert.equal(calls.rpc, 1);

  // The conflicting remote edit is resolved elsewhere; the retry now applies.
  remoteThings.set(
    "gone",
    remoteThing(owner.userId, {
      id: "gone",
      updated_at: "2020-01-01T00:00:00.000Z",
    }),
  );

  const retry = await runSync({ store, supabase: client });
  assert.equal(retry.pushed, 1);

  const settled = await readStoreSyncMeta(store, owner);
  assert.equal(settled.tombstones.gone, undefined);
  assert.equal(typeof settled.cursor, "string");
  assert.equal(settled.seeded, true);
  assert.equal(calls.rpc, 2);

  await runSync({ store, supabase: client });
  assert.equal(calls.rpc, 2);
});

test("remote restores propagate, and a missing row does not", async () => {
  const { store, owner } = account();
  await store.putAlert(makeAlert({ id: "restored", dismissed: true }));
  await store.putAlert(makeAlert({ id: "still-dismissed", dismissed: true }));
  await store.putAlert(makeAlert({ id: "newly-dismissed", dismissed: false }));

  const restoredAt = "2026-10-01T00:00:00.000Z";
  const { client, calls } = fakeClient(
    [{ user: { id: owner.userId } }],
    {
      dismissals: [
        {
          user_id: owner.userId,
          alert_id: "restored",
          dismissed_at: restoredAt,
          deleted_at: restoredAt,
        },
        {
          user_id: owner.userId,
          alert_id: "newly-dismissed",
          dismissed_at: restoredAt,
          deleted_at: null,
        },
      ],
    },
  );

  let changes = 0;
  await runSync({
    store,
    supabase: client,
    onChanged: () => {
      changes += 1;
    },
  });

  const alerts = new Map(
    (await store.getAllAlerts()).map((alert) => [alert.id, alert]),
  );
  assert.equal(alerts.get("restored")?.dismissed, false);
  assert.equal(alerts.get("still-dismissed")?.dismissed, true);
  assert.equal(alerts.get("newly-dismissed")?.dismissed, true);
  assert.equal(changes, 1);
  assert.equal(calls.dismissalUpserts, 0);
});

test("a newer local dismissal is not overwritten by an older remote restore", async () => {
  const { store, owner } = account();
  await store.putAlert(makeAlert({ id: "alert", dismissed: true }));

  const pendingAt = "2030-01-01T00:00:00.000Z";
  await writeStoreSyncMeta(
    store,
    {
      ...emptySyncMeta(owner),
      pendingDismissals: {
        alert: { dismissed: true, at: pendingAt },
      },
    },
    owner,
  );

  const restoreAt = "2026-10-01T00:00:00.000Z";
  const { client, calls } = fakeClient(
    [{ user: { id: owner.userId } }],
    {
      dismissals: [
        {
          user_id: owner.userId,
          alert_id: "alert",
          dismissed_at: restoreAt,
          deleted_at: restoreAt,
        },
      ],
    },
  );

  await runSync({ store, supabase: client });

  assert.equal((await store.getAllAlerts())[0].dismissed, true);
  const pushed = calls.dismissalRows.find((row) => row.alert_id === "alert");
  assert.equal(pushed?.deleted_at, null);
  assert.deepEqual(
    (await readStoreSyncMeta(store, owner)).pendingDismissals,
    {},
  );
});

test("a queued dismissal is pushed from the account store", async () => {
  const { store, owner } = account();
  await recordDismissal(store, "alert", true);
  const { client, calls } = fakeClient([{ user: { id: owner.userId } }]);

  await runSync({ store, supabase: client });

  assert.equal(calls.dismissalUpserts, 1);
  assert.equal(calls.dismissalRows[0].user_id, owner.userId);
  assert.equal(calls.dismissalRows[0].alert_id, "alert");
  assert.equal(calls.dismissalRows[0].deleted_at, null);
  assert.deepEqual(
    (await readStoreSyncMeta(store, owner)).pendingDismissals,
    {},
  );
});

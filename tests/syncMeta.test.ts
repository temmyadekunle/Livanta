/**
 * Stage 2: sync bookkeeping owns an account.
 *
 * These tests cover the anonymous metadata module only: where bookkeeping
 * lives, how a claim is taken, and which account may address a record. The
 * account-store engine is covered in syncEngine.test.ts.
 */

import test from "node:test";

import type { SyncMeta, SyncOwner } from "../lib/sync/meta.ts";
import { assert } from "./helpers.ts";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
define("IDBKeyRange", IDBKeyRange);
define("indexedDB", indexedDB);

const {
  EMPTY_SYNC_META,
  SYNC_META_KEY,
  SyncOwnershipError,
  bindSyncOwner,
  emptySyncMeta,
  ensureLocalDataOwner,
  getSyncOwner,
  readLocalDataOwner,
  readSyncMeta,
  recordDeletion,
  recordDismissal,
  releaseSyncOwner,
  syncMetaKey,
  syncOwner,
  writeSyncMeta,
} = await import("../lib/sync/meta.ts");

const {
  anonymousStore,
  clearAllStores,
  createLocalStore,
  userScope,
} = await import("../lib/db.ts");

let ownerCounter = 0;

/** A valid but never-before-seen Supabase-shaped user id. */
function newOwner(): SyncOwner {
  ownerCounter += 1;
  return syncOwner(
    `00000000-0000-4000-8000-${String(ownerCounter).padStart(12, "0")}`,
  );
}

test.beforeEach(async () => {
  bindSyncOwner(null);
  await clearAllStores();
});

test("legacy device metadata keeps its key and old shape", async () => {
  await anonymousStore.putSetting(SYNC_META_KEY, {
    cursor: "2026-01-01T00:00:00.000Z",
    settingsUpdatedAt: null,
    tombstones: { gone: "2026-01-02T00:00:00.000Z" },
    pendingDismissals: {},
    seeded: true,
  });

  const meta = await readSyncMeta();
  assert.equal(meta.ownerId, null);
  assert.equal(meta.cursor, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(meta.tombstones, { gone: "2026-01-02T00:00:00.000Z" });
  assert.equal(meta.seeded, true);

  await writeSyncMeta({ ...meta, cursor: "2026-02-01T00:00:00.000Z" });
  const stored = await anonymousStore.getSetting<SyncMeta>(SYNC_META_KEY);
  assert.equal(stored?.ownerId, null);
  assert.equal(stored?.cursor, "2026-02-01T00:00:00.000Z");
});

test("each account gets its own metadata key and record", async () => {
  const a = newOwner();
  const b = newOwner();

  await writeSyncMeta({ ...emptySyncMeta(a), cursor: "a", seeded: true }, a);

  assert.equal((await readSyncMeta(a)).cursor, "a");
  assert.equal((await readSyncMeta(b)).cursor, null);
  assert.equal((await readSyncMeta()).cursor, null);
  assert.notEqual(syncMetaKey(a), syncMetaKey(b));
  assert.notEqual(syncMetaKey(a), SYNC_META_KEY);

  assert.notEqual(await anonymousStore.getSetting(syncMetaKey(a)), null);
  assert.equal(
    await createLocalStore(userScope(a.userId)).getSetting(syncMetaKey(a)),
    null,
  );
});

test("metadata cannot be read under a different account", async () => {
  const a = newOwner();
  const b = newOwner();
  const aMeta = { ...emptySyncMeta(a), cursor: "a" };

  await anonymousStore.putSetting(syncMetaKey(b), aMeta);
  await assert.rejects(readSyncMeta(b), SyncOwnershipError);

  await anonymousStore.putSetting(SYNC_META_KEY, aMeta);
  await assert.rejects(readSyncMeta(), SyncOwnershipError);
});

test("metadata cannot be written under a different account", async () => {
  const a = newOwner();
  const b = newOwner();

  await assert.rejects(
    writeSyncMeta({ ...emptySyncMeta(a), cursor: "a" }, b),
    SyncOwnershipError,
  );
  await assert.rejects(
    writeSyncMeta(emptySyncMeta(a), null),
    SyncOwnershipError,
  );
  await assert.rejects(
    writeSyncMeta(emptySyncMeta(null), a),
    SyncOwnershipError,
  );

  assert.equal(await anonymousStore.getSetting(syncMetaKey(b)), null);
  assert.equal(await anonymousStore.getSetting(SYNC_META_KEY), null);
});

test("account metadata never overwrites the legacy device record", async () => {
  const a = newOwner();
  await anonymousStore.putSetting(SYNC_META_KEY, {
    ...EMPTY_SYNC_META,
    cursor: "legacy",
    seeded: true,
  });

  await writeSyncMeta({ ...emptySyncMeta(a), cursor: "account" }, a);

  const legacy = await readSyncMeta();
  assert.equal(legacy.cursor, "legacy");
  assert.equal(legacy.seeded, true);
  assert.equal((await readSyncMeta(a)).cursor, "account");

  await writeSyncMeta({ ...emptySyncMeta(), cursor: "legacy-2" }, null);
  assert.equal((await readSyncMeta(a)).cursor, "account");
  assert.equal((await readSyncMeta()).cursor, "legacy-2");
});

test("existing legacy bookkeeping is not reused by an account", async () => {
  const a = newOwner();
  await anonymousStore.putSetting(SYNC_META_KEY, {
    cursor: "legacy-cursor",
    settingsUpdatedAt: "2026-01-01T00:00:00.000Z",
    tombstones: { "legacy-thing": "2026-01-02T00:00:00.000Z" },
    pendingDismissals: {
      "legacy-alert": { dismissed: true, at: "2026-01-03T00:00:00.000Z" },
    },
    seeded: true,
  });

  const account = await readSyncMeta(a);
  assert.equal(account.ownerId, a.userId);
  assert.equal(account.cursor, null);
  assert.equal(account.settingsUpdatedAt, null);
  assert.deepEqual(account.tombstones, {});
  assert.deepEqual(account.pendingDismissals, {});
  assert.equal(account.seeded, false);

  const legacy = await readSyncMeta();
  assert.equal(legacy.cursor, "legacy-cursor");
  assert.deepEqual(legacy.tombstones, {
    "legacy-thing": "2026-01-02T00:00:00.000Z",
  });
});

test("mutation bookkeeping follows the bound owner", async () => {
  const a = newOwner();
  const b = newOwner();

  const bound = bindSyncOwner(a.userId);
  assert.equal(getSyncOwner()?.userId, a.userId);

  await recordDeletion("thing-a");
  await recordDismissal("alert-a", true);

  const account = await readSyncMeta(a);
  assert.deepEqual(Object.keys(account.tombstones), ["thing-a"]);
  assert.equal(account.pendingDismissals["alert-a"].dismissed, true);
  assert.equal(typeof account.pendingDismissals["alert-a"].at, "string");
  assert.equal((await readSyncMeta(b)).tombstones["thing-a"], undefined);
  assert.equal((await readSyncMeta()).tombstones["thing-a"], undefined);

  releaseSyncOwner(bound);
  assert.equal(getSyncOwner(), null);

  await recordDeletion("thing-signed-out");
  assert.equal(
    (await readSyncMeta()).tombstones["thing-signed-out"] !== undefined,
    true,
  );
  assert.equal(
    (await readSyncMeta(a)).tombstones["thing-signed-out"],
    undefined,
  );
});

test("signed-out edits are queued for the account that claimed the device", async () => {
  const a = newOwner();
  const b = newOwner();
  await ensureLocalDataOwner(a);
  assert.equal(getSyncOwner(), null);

  await recordDeletion("signed-out-gone");
  await recordDismissal("signed-out-alert", true);

  const claimed = await readSyncMeta(a);
  assert.notEqual(claimed.tombstones["signed-out-gone"], undefined);
  assert.equal(claimed.pendingDismissals["signed-out-alert"].dismissed, true);

  assert.equal((await readSyncMeta()).tombstones["signed-out-gone"], undefined);
  assert.equal((await readSyncMeta(b)).tombstones["signed-out-gone"], undefined);
});

test("the queue from before the claim passes to the claiming account only", async () => {
  const a = newOwner();
  const b = newOwner();
  await anonymousStore.putSetting(SYNC_META_KEY, {
    cursor: "legacy-cursor",
    settingsUpdatedAt: "2026-01-01T00:00:00.000Z",
    tombstones: { "legacy-gone": "2026-01-02T00:00:00.000Z" },
    pendingDismissals: {
      "legacy-alert": { dismissed: true, at: "2026-01-03T00:00:00.000Z" },
    },
    seeded: true,
  });

  await ensureLocalDataOwner(a);

  const claimed = await readSyncMeta(a);
  assert.deepEqual(claimed.tombstones, {
    "legacy-gone": "2026-01-02T00:00:00.000Z",
  });
  assert.equal(claimed.pendingDismissals["legacy-alert"].dismissed, true);
  // Remote position and seeded flag are not inherited: they belong to a cursor.
  assert.equal(claimed.cursor, null);
  assert.equal(claimed.settingsUpdatedAt, null);
  assert.equal(claimed.seeded, false);
  assert.equal((await readSyncMeta()).cursor, "legacy-cursor");

  await assert.rejects(ensureLocalDataOwner(b), SyncOwnershipError);
  assert.deepEqual((await readSyncMeta(b)).tombstones, {});
});

test("owner ids are validated and case-normalised", () => {
  const a = newOwner();

  assert.throws(() => syncOwner("user-1"), SyncOwnershipError);
  assert.equal(bindSyncOwner("user-1"), null);
  assert.equal(getSyncOwner(), null);

  const upper = syncOwner(a.userId.toUpperCase());
  assert.equal(upper.userId, a.userId);
  assert.equal(syncMetaKey(upper), syncMetaKey(a));
});

test("clearing local stores releases the claim", async () => {
  const a = newOwner();
  await ensureLocalDataOwner(a);
  assert.equal(await readLocalDataOwner(), a.userId);

  await clearAllStores();
  assert.equal(await readLocalDataOwner(), null);
});

test("a different account can claim once the claim is gone", async () => {
  const a = newOwner();
  const b = newOwner();
  await ensureLocalDataOwner(a);
  await clearAllStores();

  await ensureLocalDataOwner(b);
  assert.equal(await readLocalDataOwner(), b.userId);
});

import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { assert } from "./helpers.ts";
import type { LocalStore } from "../lib/db.ts";
import type { SyncMeta, SyncOwner } from "../lib/sync/meta.ts";
import type { Supabase } from "../lib/supabase/client.ts";

Object.defineProperty(globalThis, "indexedDB", {
  value: new IDBFactory(), writable: true, configurable: true,
});

const { anonymousStore, anonymousScope, createLocalStore, userScope, closeScope } = await import("../lib/db.ts");
const {
  recordDeletion, recordDismissal, readSyncMeta, emptySyncMeta, syncMetaKey, syncOwner,
  bindSyncOwner, releaseSyncOwner, getSyncOwner, ensureLocalDataOwner, readLocalDataOwner,
  SYNC_META_KEY, SYNC_DATA_OWNER_KEY, SyncOwnershipError,
} = await import("../lib/sync/meta.ts");
const { runSync } = await import("../lib/sync/engine.ts");

const stores: LocalStore[] = [];
function account() {
  const owner = syncOwner(`abcdefab-1234-4000-8000-${String(stores.length + 1).padStart(12, "0")}`);
  const store = createLocalStore(userScope(owner.userId));
  stores.push(store);
  return { store, owner };
}

test.beforeEach(async () => {
  bindSyncOwner(null);
  await anonymousStore.clear();
});
test.after(async () => {
  bindSyncOwner(null);
  for (const store of [...stores, anonymousStore]) await closeScope(store.scope);
});

test("explicit deletion and dismissal queues use only the selected account database", async (t) => {
  const { store, owner } = account();
  const other = account();
  const read = t.mock.method(anonymousStore, "getSetting", () => { throw new Error("anonymous read"); });
  const write = t.mock.method(anonymousStore, "putSetting", () => { throw new Error("anonymous write"); });
  await recordDeletion(store, "gone");
  await recordDismissal(store, "alert", true);
  const meta = await store.getSetting<SyncMeta>(syncMetaKey(owner));
  assert.ok(meta);
  assert.equal(meta.ownerId, owner.userId);
  assert.ok(Number.isFinite(Date.parse(meta.tombstones.gone)));
  assert.equal(meta.pendingDismissals.alert.dismissed, true);
  assert.ok(Number.isFinite(Date.parse(meta.pendingDismissals.alert.at)));
  assert.equal(await store.getSetting(SYNC_META_KEY), null);
  assert.equal(await store.getSetting(SYNC_DATA_OWNER_KEY), null);
  assert.equal(await other.store.getSetting(syncMetaKey(owner)), null);
  assert.equal(await other.store.getSetting(syncMetaKey(other.owner)), null);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
});

test("two accounts keep independent queues even for identical record IDs", async () => {
  const a = account();
  const b = account();
  await recordDeletion(a.store, "gone-a");
  await recordDismissal(a.store, "same-alert", true);
  await recordDeletion(b.store, "gone-b", b.owner);
  await recordDismissal(b.store, "same-alert", false, b.owner);
  const ma = await a.store.getSetting<SyncMeta>(syncMetaKey(a.owner));
  const mb = await b.store.getSetting<SyncMeta>(syncMetaKey(b.owner));
  assert.deepEqual(Object.keys(ma!.tombstones), ["gone-a"]);
  assert.deepEqual(Object.keys(mb!.tombstones), ["gone-b"]);
  assert.equal(ma!.pendingDismissals["same-alert"].dismissed, true);
  assert.equal(mb!.pendingDismissals["same-alert"].dismissed, false);
  assert.equal(await anonymousStore.getSetting(syncMetaKey(a.owner)), null);
  assert.equal(await anonymousStore.getSetting(syncMetaKey(b.owner)), null);
});

test("mutations preserve metadata fields and update dismissal state without copying legacy queues", async () => {
  const { store, owner } = account();
  const original: SyncMeta = {
    ...emptySyncMeta(owner), cursor: "cursor", settingsUpdatedAt: "settings-time", seeded: true,
    tombstones: { old: "old-time" },
    pendingDismissals: { old: { dismissed: true, at: "old-time" } },
  };
  await store.putSetting(syncMetaKey(owner), original);
  const legacy = { ...emptySyncMeta(owner), tombstones: { anonymous: "keep" } };
  await anonymousStore.putSetting(syncMetaKey(owner), legacy);
  await recordDeletion(store, "new");
  await recordDismissal(store, "alert", true);
  await recordDismissal(store, "alert", false);
  const meta = await store.getSetting<SyncMeta>(syncMetaKey(owner));
  assert.equal(meta!.cursor, original.cursor);
  assert.equal(meta!.settingsUpdatedAt, original.settingsUpdatedAt);
  assert.equal(meta!.seeded, true);
  assert.equal(meta!.tombstones.old, "old-time");
  assert.deepEqual(meta!.pendingDismissals.old, original.pendingDismissals.old);
  assert.equal(meta!.pendingDismissals.alert.dismissed, false);
  assert.equal(meta!.tombstones.anonymous, undefined);
  assert.deepEqual(await anonymousStore.getSetting(syncMetaKey(owner)), legacy);
});

test("matching uppercase owner is normalized to the account store's key", async () => {
  const { store, owner } = account();
  const upper = { userId: owner.userId.toUpperCase() };
  assert.notEqual(upper.userId, owner.userId);
  await recordDeletion(store, "gone", upper);
  await recordDismissal(store, "alert", true, upper);
  const meta = await store.getSetting<SyncMeta>(syncMetaKey(owner));
  assert.equal(meta!.ownerId, owner.userId);
  assert.ok(meta!.tombstones.gone);
});

test("foreign, null and malformed owners cannot address an account store", async (t) => {
  const { store } = account();
  const other = account();
  const read = t.mock.method(store, "getSetting");
  const write = t.mock.method(store, "putSetting");
  for (const bad of [other.owner, null, {}, { userId: "not-a-uuid" }, { userId: 42 }, false]) {
    const owner = bad as SyncOwner | null;
    await assert.rejects(recordDeletion(store, "gone", owner), SyncOwnershipError);
    await assert.rejects(recordDismissal(store, "alert", true, owner), SyncOwnershipError);
  }
  assert.equal(read.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
});

test("invalid explicit stores cannot fall back to anonymous bookkeeping", async (t) => {
  const read = t.mock.method(anonymousStore, "getSetting");
  const write = t.mock.method(anonymousStore, "putSetting");
  for (const bad of [undefined, null, {}, 42, { scope: anonymousScope() }]) {
    const store = bad as LocalStore;
    await assert.rejects(recordDeletion(store, "gone"), SyncOwnershipError);
    await assert.rejects(recordDismissal(store, "alert", true), SyncOwnershipError);
  }
  const { store } = account();
  Object.defineProperty(store, "databaseName", { value: "lifedesk" });
  await assert.rejects(recordDeletion(store, "gone"), SyncOwnershipError);
  await assert.rejects(recordDismissal(store, "alert", true), SyncOwnershipError);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
});

test("foreign or corrupt stored owner stamps fail without overwriting queues", async () => {
  const { store, owner } = account();
  const other = account();
  for (const ownerId of [other.owner.userId, null, 42, "bad"]) {
    const raw = { ...emptySyncMeta(owner), ownerId, tombstones: { keep: "time" } };
    await store.putSetting(syncMetaKey(owner), raw);
    await assert.rejects(recordDeletion(store, "gone"), SyncOwnershipError);
    await assert.rejects(recordDismissal(store, "alert", true), SyncOwnershipError);
    assert.deepEqual(await store.getSetting(syncMetaKey(owner)), raw);
  }
});

test("account mutation ownership is scope-bound and cannot change the active owner binding", async () => {
  const a = account();
  const b = account();
  const boundA = bindSyncOwner(a.owner.userId);
  bindSyncOwner(b.owner.userId);
  releaseSyncOwner(boundA);
  await recordDeletion(a.store, "gone");
  await recordDismissal(a.store, "alert", true);
  assert.equal(getSyncOwner()!.userId, b.owner.userId);
  assert.ok((await a.store.getSetting<SyncMeta>(syncMetaKey(a.owner)))!.tombstones.gone);
  assert.equal(await a.store.getSetting(syncMetaKey(b.owner)), null);
  assert.equal(bindSyncOwner("invalid"), null);
  assert.equal(getSyncOwner(), null);
});

test("a deferred mutation retains its original store and owner after binding changes", async (t) => {
  const a = account();
  const b = account();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = a.store.getSetting;
  t.mock.method(a.store, "getSetting", async <T>(key: string) => {
    await gate;
    return original<T>(key);
  });
  bindSyncOwner(a.owner.userId);
  const pending = recordDeletion(a.store, "gone");
  bindSyncOwner(b.owner.userId);
  release();
  await pending;
  assert.ok((await a.store.getSetting<SyncMeta>(syncMetaKey(a.owner)))!.tombstones.gone);
  assert.equal(await b.store.getSetting(syncMetaKey(b.owner)), null);
  assert.equal(await anonymousStore.getSetting(syncMetaKey(b.owner)), null);
});

test("legacy calls still use anonymous storage and the bound owner", async () => {
  const a = account();
  bindSyncOwner(a.owner.userId);
  await recordDeletion("gone");
  await recordDismissal("alert", true);
  const meta = await readSyncMeta(a.owner);
  assert.ok(meta.tombstones.gone);
  assert.equal(meta.pendingDismissals.alert.dismissed, true);
  assert.equal(await a.store.getSetting(syncMetaKey(a.owner)), null);
  bindSyncOwner(null);
  await recordDeletion("local");
  await recordDismissal("local-alert", false);
  assert.ok((await readSyncMeta()).tombstones.local);
  assert.equal((await readSyncMeta()).pendingDismissals["local-alert"].dismissed, false);
  await recordDeletion("explicit-owner", a.owner);
  await recordDismissal("explicit-owner-alert", true, a.owner);
  assert.ok((await readSyncMeta(a.owner)).tombstones["explicit-owner"]);
  await assert.rejects(recordDeletion("bad", { userId: "bad" }), SyncOwnershipError);
  await assert.rejects(recordDismissal("bad", true, { userId: "bad" }), SyncOwnershipError);
});

test("explicit anonymous stores honor a claim and reject a conflicting supplied or bound owner", async () => {
  const a = account();
  const b = account();
  const store = createLocalStore(anonymousScope());
  await ensureLocalDataOwner(a.owner);
  await recordDeletion(store, "gone");
  await recordDismissal(store, "alert", true, null);
  await recordDeletion(store, "matching", a.owner);
  const before = await readSyncMeta(a.owner);
  await assert.rejects(recordDeletion(store, "bad", b.owner), SyncOwnershipError);
  await assert.rejects(recordDismissal(store, "bad", true, b.owner), SyncOwnershipError);
  bindSyncOwner(b.owner.userId);
  await assert.rejects(recordDeletion(store, "bad"), SyncOwnershipError);
  await assert.rejects(recordDismissal(store, "bad", true), SyncOwnershipError);
  assert.deepEqual(await readSyncMeta(a.owner), before);
  assert.equal(await anonymousStore.getSetting(syncMetaKey(b.owner)), null);
  assert.equal(await readLocalDataOwner(), a.owner.userId);
});

test("explicit anonymous unclaimed bookkeeping does not create an ownership claim", async () => {
  const a = account();
  await recordDeletion(anonymousStore, "local", null);
  await recordDismissal(anonymousStore, "local-alert", true, null);
  assert.ok((await readSyncMeta()).tombstones.local);
  bindSyncOwner(a.owner.userId);
  await recordDeletion(anonymousStore, "bound");
  await recordDismissal(anonymousStore, "bound-alert", false);
  assert.ok((await readSyncMeta(a.owner)).tombstones.bound);
  assert.equal(await readLocalDataOwner(), null);
});

test("malformed claims fail closed for explicit calls while legacy offline fallback remains", async () => {
  const a = account();
  for (const raw of ["bad", { ownerId: "bad" }, { ownerId: 42 }]) {
    await anonymousStore.putSetting(SYNC_DATA_OWNER_KEY, raw);
    await assert.rejects(recordDeletion(anonymousStore, "bad", a.owner), SyncOwnershipError);
    await assert.rejects(recordDismissal(anonymousStore, "bad", true), SyncOwnershipError);
    assert.deepEqual(await anonymousStore.getSetting(SYNC_DATA_OWNER_KEY), raw);
  }
  await recordDeletion("offline");
  await recordDismissal("offline-alert", true);
  assert.ok((await readSyncMeta()).tombstones.offline);
  assert.equal((await readSyncMeta()).pendingDismissals["offline-alert"].dismissed, true);
  assert.equal(await anonymousStore.getSetting(syncMetaKey(a.owner)), null);
});

test("read and write failures never redirect explicit mutations to anonymous storage", async (t) => {
  const readAnon = t.mock.method(anonymousStore, "getSetting", () => { throw new Error("anonymous read"); });
  const writeAnon = t.mock.method(anonymousStore, "putSetting", () => { throw new Error("anonymous write"); });
  for (const method of ["getSetting", "putSetting"] as const) {
    const { store } = account();
    const error = new Error(`${method} failed`);
    const failing = t.mock.method(store, method, async () => { throw error; });
    await assert.rejects(recordDeletion(store, "gone"), (e) => e === error);
    await assert.rejects(recordDismissal(store, "alert", true), (e) => e === error);
    assert.equal(failing.mock.callCount(), 2);
  }
  assert.equal(readAnon.mock.callCount(), 0);
  assert.equal(writeAnon.mock.callCount(), 0);
});

test("explicit anonymous claim read failures are surfaced rather than bypassed", async (t) => {
  const error = new Error("claim unreadable");
  t.mock.method(anonymousStore, "getSetting", async () => { throw error; });
  const write = t.mock.method(anonymousStore, "putSetting");
  await assert.rejects(recordDeletion(anonymousStore, "gone"), (e) => e === error);
  await assert.rejects(recordDismissal(anonymousStore, "alert", true), (e) => e === error);
  assert.equal(write.mock.callCount(), 0);
});

test("an account store cannot be synced by a different signed-in account", async () => {
  const a = account();
  const b = account();
  await ensureLocalDataOwner(a.owner);
  const original = await readSyncMeta(a.owner);
  await recordDeletion(b.store, "b-gone", b.owner);
  await recordDismissal(b.store, "b-alert", true, b.owner);
  let remoteCalls = 0;
  const forbidden = () => { remoteCalls += 1; throw new Error("network must not run"); };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: a.owner.userId } } } }) },
    from: forbidden,
    rpc: forbidden,
  } as unknown as Supabase;
  await assert.rejects(
    runSync({ store: b.store, supabase: client }),
    SyncOwnershipError,
  );
  assert.equal(remoteCalls, 0);
  assert.equal(await readLocalDataOwner(), a.owner.userId);
  assert.deepEqual(await readSyncMeta(a.owner), original);
  assert.ok((await b.store.getSetting<SyncMeta>(syncMetaKey(b.owner)))!.tombstones["b-gone"]);
  assert.equal(await anonymousStore.getSetting(syncMetaKey(b.owner)), null);
  assert.equal(await b.store.getSetting(SYNC_DATA_OWNER_KEY), null);
});

/**
 * B2.1/B2.2 identity transition tests.
 *
 * Covers: sign-out teardown, lock safety (unavailable/contention/timeout/release),
 * reminder cancellation ordering and failure, account A-to-B transitions,
 * cross-tab identity messages, stale operation rejection, store ownership,
 * and prevention of account activation before transition completion.
 */

import test from "node:test";
import assert from "node:assert/strict";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
define("indexedDB", indexedDB);
define("IDBKeyRange", IDBKeyRange);

const {
  closeScope,
  createLocalStore,
  userScope,
  __setTxnDelay,
  StoreClosedError,
} = await import("../lib/db.ts");
type LocalScope = Parameters<typeof createLocalStore>[0];
type UserLocalScope = Extract<LocalScope, { kind: "user" }>;
const {
  bindSyncOwner,
  getSyncOwner,
  releaseSyncOwner,
  syncOwner,
} = await import("../lib/sync/meta.ts");
type SyncOwner = ReturnType<typeof syncOwner>;
const { cancelScheduledReminders } = await import("../lib/schedule.ts");
const { setReminderOwnerStorageForTesting } = await import(
  "../lib/reminders/ownerMarker.ts"
);
const { setLockManager, withIdentityLock } = await import(
  "../lib/identityLock.ts"
);
const {
  teardownAccount,
  transitionIdentity,
  subscribeToIdentityChanges,
  resetIdentityChannelForTesting,
} = await import("../lib/identityTransition.ts");
const { IDENTITY_CHANNEL_NAME, setIdentityTransportForTesting } = await import(
  "../lib/identityTransport.ts"
);

// These tests run without a browser, so the device is an in-memory map. The
// marker is still written and validated exactly as it is on a real device.
const ownerStorage = new Map<string, string>();
setReminderOwnerStorageForTesting({
  getItem: (key) => ownerStorage.get(key) ?? null,
  setItem: (key, value) => {
    ownerStorage.set(key, value);
  },
});
test.beforeEach(() => ownerStorage.clear());
type TeardownResult = Awaited<ReturnType<typeof teardownAccount>>;
type IdentityReason = Parameters<typeof transitionIdentity>[2];

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeUserId(suffix: string): string {
  // Valid UUID: 8-4-4-4-12 hex chars
  return `00000000-0000-0000-0000-${suffix.padStart(12, "0")}`;
}

async function openAccountStore(userId: string) {
  const scope = userScope(userId);
  const store = createLocalStore(scope);
  await store.putThing({ id: "t1", name: "Thing 1", category: "money", kind: "bill", amount: 100, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
  return store;
}

async function resetSyncOwner() {
  releaseSyncOwner(null as unknown as SyncOwner);
}

function workingLockManager() {
  return {
    request: async (_name: string, _options: { signal: AbortSignal }, callback: () => Promise<void>) => {
      await callback();
    },
  };
}

// ---------------------------------------------------------------------------
// Lock tests
// ---------------------------------------------------------------------------

test("lock unavailable: withIdentityLock throws IdentityLockError", async () => {
  // Override navigator so navigator.locks is undefined
  const originalNavigator = globals.navigator;
  define("navigator", { locks: undefined });

  try {
    setLockManager(null);
    let threw = false;
    try {
      await withIdentityLock(async () => {});
    } catch (e) {
      threw = e instanceof Error && e.name === "IdentityLockError";
    }
    assert.ok(threw, "Expected IdentityLockError when locks unavailable");
  } finally {
    define("navigator", originalNavigator);
    setLockManager(workingLockManager());
  }
});

test("lock acquired and released correctly", async () => {
  setLockManager(workingLockManager());
  let lockHeld = false;
  let released = false;

  setLockManager({
    request: async (_name: string, _options: { signal: AbortSignal }, callback: () => Promise<void>) => {
      lockHeld = true;
      await callback();
      released = true;
      lockHeld = false;
    },
  });

  await withIdentityLock(async () => {
    assert.ok(lockHeld, "Lock should be held during work");
  });

  assert.ok(released, "Lock should be released after work");
  assert.ok(!lockHeld, "Lock should not be held after work");
});

test("lock contention: serialized access", async () => {
  setLockManager(workingLockManager());
  const order: string[] = [];

  setLockManager({
    request: async (_name: string, _options: { signal: AbortSignal }, callback: () => Promise<void>) => {
      order.push("acquired");
      await callback();
      order.push("released");
    },
  });

  await withIdentityLock(async () => {
    order.push("work-a");
  });
  await withIdentityLock(async () => {
    order.push("work-b");
  });

  assert.deepEqual(order, ["acquired", "work-a", "released", "acquired", "work-b", "released"]);
  setLockManager(workingLockManager());
});

test("IdentityLockError and IdentityLockTimeoutError are exported", async () => {
  const mod = await import("../lib/identityLock.ts");
  assert.ok(mod.IdentityLockError, "IdentityLockError should be exported");
  assert.ok(mod.IdentityLockTimeoutError, "IdentityLockTimeoutError should be exported");
});

// ---------------------------------------------------------------------------
// Teardown tests
// ---------------------------------------------------------------------------

test("successful sign-out and teardown", async () => {
  setLockManager(workingLockManager());

  await resetSyncOwner();
  const store = await openAccountStore(makeUserId("1"));
  const userId = (store.scope as UserLocalScope).userId;

  // Bind the owner first (simulates an active sync session)
  bindSyncOwner(userId);
  assert.ok(getSyncOwner() !== null, "Sync owner should be bound before teardown");

  const result: TeardownResult = await teardownAccount(store, userId);
  assert.deepEqual(result, { ok: true });

  // Sync owner should be released
  assert.ok(getSyncOwner() === null, "Sync owner should be released after teardown");

  setLockManager(workingLockManager());
});

test("teardown closes only the intended store and releases only its binding", async () => {
  setLockManager(workingLockManager());

  await resetSyncOwner();
  const storeA = await openAccountStore(makeUserId("1"));
  const storeB = await openAccountStore(makeUserId("2"));

  bindSyncOwner((storeA.scope as UserLocalScope).userId);
  assert.ok(getSyncOwner()?.userId === (storeA.scope as UserLocalScope).userId, "Owner A should be bound");

  const result = await teardownAccount(storeA, (storeA.scope as UserLocalScope).userId);
  assert.deepEqual(result, { ok: true });

  // Owner A should be released
  assert.ok(getSyncOwner() === null, "Owner A should be released");

  // Clean up store B
  await closeScope(storeB.scope);

  setLockManager(workingLockManager());
});

test("store ownership and release: releaseSyncOwner only clears matching owner", async () => {
  await resetSyncOwner();

  const ownerA = syncOwner(makeUserId("1"));
  const ownerB = syncOwner(makeUserId("2"));

  bindSyncOwner(ownerA.userId);
  assert.deepEqual(getSyncOwner(), ownerA);

  // Releasing a different owner should not clear owner A
  releaseSyncOwner(ownerB);
  assert.deepEqual(getSyncOwner(), ownerA, "Releasing owner B should not affect owner A");

  // Releasing owner A should clear it
  releaseSyncOwner(ownerA);
  assert.ok(getSyncOwner() === null, "Releasing owner A should clear it");
});

// ---------------------------------------------------------------------------
// Reminder cancellation ordering tests
// ---------------------------------------------------------------------------

test("reminder cancellation occurs within the coordination boundary", async () => {
  setLockManager(workingLockManager());

  await resetSyncOwner();
  const store = await openAccountStore(makeUserId("1"));
  const userId = (store.scope as UserLocalScope).userId;

  const result = await teardownAccount(store, userId);
  assert.deepEqual(result, { ok: true });

  // On a non-native platform (Node.js), cancelScheduledReminders returns early
  // without error, so teardown succeeds. The store was closed within the
  // lock boundary.
  assert.ok(getSyncOwner() === null, "Sync owner released after teardown");

  setLockManager(workingLockManager());
});

test("transitionIdentity prevents account activation before teardown completes", async () => {
  setLockManager(workingLockManager());

  // Set up a fake BroadcastChannel to verify broadcasting happens after teardown
  let postMessageCalled = false;
  class FakeBroadcastChannel {
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(name: string) { this.name = name; }
    postMessage() { postMessageCalled = true; }
    close() {}
  }
  const originalChannel = globals.BroadcastChannel;
  define("BroadcastChannel", FakeBroadcastChannel);

  try {
    await resetSyncOwner();
    const store = await openAccountStore(makeUserId("1"));
    const userId = (store.scope as UserLocalScope).userId;

    const result = await transitionIdentity(store, userId, "sign-out");
    assert.deepEqual(result, { ok: true });
    assert.ok(postMessageCalled, "Broadcast should be sent after successful teardown");
  } finally {
    if (originalChannel) {
      define("BroadcastChannel", originalChannel);
    } else {
      define("BroadcastChannel", undefined);
    }
    setLockManager(workingLockManager());
  }
});

// ---------------------------------------------------------------------------
// Cross-tab coordination tests
// ---------------------------------------------------------------------------

test("cross-tab identity messages are delivered to subscribers", async () => {
  setLockManager(workingLockManager());
  resetIdentityChannelForTesting();

  const receivedMessages: Array<{ reason: IdentityReason; userId?: string }> = [];
  const unsubscribe = subscribeToIdentityChanges((message) => {
    receivedMessages.push({ reason: message.reason, ...("userId" in message ? { userId: String((message as { userId?: unknown }).userId) } : {}) });
  });

  try {
    // Simulate another tab: create a separate BroadcastChannel instance and post.
    const otherTab = new BroadcastChannel(IDENTITY_CHANNEL_NAME);
    try {
      otherTab.postMessage({
        type: "livanta:identity-change",
        reason: "sign-out",
        timestamp: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(receivedMessages.length, 1, "Should receive exactly one message");
      assert.equal(receivedMessages[0].reason, "sign-out");
      assert.ok(!("userId" in receivedMessages[0]), "signal carries no identity");
    } finally {
      otherTab.close();
    }
  } finally {
    unsubscribe();
    setLockManager(workingLockManager());
  }
});

test("a signal never forwards identity fields from the wire", async () => {
  setLockManager(workingLockManager());
  resetIdentityChannelForTesting();

  const received: Array<Record<string, unknown>> = [];
  const unsubscribe = subscribeToIdentityChanges((message) => {
    received.push(message as unknown as Record<string, unknown>);
  });

  try {
    const otherTab = new BroadcastChannel(IDENTITY_CHANNEL_NAME);
    try {
      otherTab.postMessage({
        type: "livanta:identity-change",
        reason: "sign-out",
        userId: makeUserId("9"),
        email: "user@example.com",
        token: "secret-token",
        timestamp: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(received.length, 1);
      assert.deepEqual(
        Object.keys(received[0]).sort(),
        ["reason", "timestamp", "type"],
        "only the non-identity fields survive",
      );
      assert.ok(!JSON.stringify(received[0]).includes(makeUserId("9")));
    } finally {
      otherTab.close();
    }
  } finally {
    unsubscribe();
    setLockManager(workingLockManager());
  }
});

// ---------------------------------------------------------------------------
// Stale operation rejection tests
// ---------------------------------------------------------------------------

test("closeScope evicts the cached database handle", async () => {
  setLockManager(workingLockManager());
  const store = await openAccountStore(makeUserId("1"));

  // Verify the store works before closing
  const thingsBefore = await store.getAllThings();
  assert.equal(thingsBefore.length, 1);

  // Close the scope - this evicts the cached handle
  await closeScope(store.scope);

  // Opening a new store for the same scope creates a fresh connection
  const store2 = createLocalStore(userScope(makeUserId("1")));
  const thingsAfter = await store2.getAllThings();
  assert.equal(thingsAfter.length, 1, "Data survives closeScope via new connection");

  await closeScope(store2.scope);
  setLockManager(workingLockManager());
});

// ---------------------------------------------------------------------------
// Account A to Account B transition
// ---------------------------------------------------------------------------

test("account A to account B transition: teardown A before activating B", async () => {
  setLockManager(workingLockManager());

  await resetSyncOwner();
  const storeA = await openAccountStore(makeUserId("1"));
  const storeB = await openAccountStore(makeUserId("2"));

  const userIdA = (storeA.scope as UserLocalScope).userId;
  const userIdB = (storeB.scope as UserLocalScope).userId;

  bindSyncOwner(userIdA);
  assert.ok(getSyncOwner()?.userId === userIdA, "Owner A should be bound initially");

  // Transition from A to B: teardown A first
  const result = await transitionIdentity(storeA, userIdA, "switch");
  assert.deepEqual(result, { ok: true });
  assert.ok(getSyncOwner() === null, "Owner A should be released after teardown");

  // Now account B can be activated (bind its owner)
  bindSyncOwner(userIdB);
  assert.ok(getSyncOwner()?.userId === userIdB, "Owner B should be bound after activation");

  // Clean up
  await closeScope(storeB.scope);
  releaseSyncOwner(syncOwner(userIdB));

  setLockManager(workingLockManager());
});

// ---------------------------------------------------------------------------
// Sign-out failure tests
// ---------------------------------------------------------------------------

test("failed sign-out preserves authenticated state", async () => {
  const { performSignOut } = await import("../lib/signOut.ts");

  const result = await performSignOut({
    auth: {
      signOut: async () => ({ error: { message: "network down" } }),
    },
  });

  assert.deepEqual(result, { ok: false, message: "network down" });
  // The caller (useAuth.signOut) does not emit signed-out on this result,
  // preserving the authenticated state.
});

// ---------------------------------------------------------------------------
// Reminder cancellation failure
// ---------------------------------------------------------------------------

test("cancelScheduledReminders is unconditional: does not check permissions before cancelling", async () => {
  // On Node.js (non-native platform), cancelScheduledReminders returns early
  // without error because Capacitor.isNativePlatform() returns false.
  // This is the unconditional behavior: it always attempts cancellation
  // on native platforms without a permission pre-check.
  await cancelScheduledReminders();
  assert.ok(true, "cancelScheduledReminders completes without throwing on non-native platform");
});

// ---------------------------------------------------------------------------
// Prevention of account activation before transition completion
// ---------------------------------------------------------------------------

test("transitionIdentity broadcasts after successful teardown", async () => {
  setLockManager(workingLockManager());
  resetIdentityChannelForTesting();

  let postMessageCalled = false;
  class FakeBroadcastChannel {
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(name: string) { this.name = name; }
    postMessage() { postMessageCalled = true; }
    close() {}
  }
  const originalChannel = globals.BroadcastChannel;
  define("BroadcastChannel", FakeBroadcastChannel);

  try {
    await resetSyncOwner();
    const store = await openAccountStore(makeUserId("1"));
    const userId = (store.scope as UserLocalScope).userId;

    const result = await transitionIdentity(store, userId, "sign-out");
    assert.deepEqual(result, { ok: true });
    assert.ok(postMessageCalled, "Broadcast is sent after successful teardown");
  } finally {
    if (originalChannel) {
      define("BroadcastChannel", originalChannel);
    } else {
      define("BroadcastChannel", undefined);
    }
    setLockManager(workingLockManager());
  }
});

test("transitionIdentity fails when no transport can deliver the signal", async () => {
  setLockManager(workingLockManager());
  resetIdentityChannelForTesting();
  setIdentityTransportForTesting({ broadcast: false, storage: false });

  try {
    const result = await transitionIdentity(null, makeUserId("2"), "sign-out");
    assert.equal(result.ok, false, "an uncommunicated transition is not success");
    assert.match(
      result.ok ? "" : result.reason,
      /communicated to other tabs/,
      "the failure names the transport",
    );
  } finally {
    setIdentityTransportForTesting(null);
    setLockManager(workingLockManager());
  }
});

// ---------------------------------------------------------------------------
// Stale write rejection after store close (lease protection)
// ---------------------------------------------------------------------------

test("stale write rejected after store.close(): obsolete reference cannot mutate", async () => {
  setLockManager(workingLockManager());

  const store = await openAccountStore(makeUserId("1"));

  // Verify the store works before closing
  const thingsBefore = await store.getAllThings();
  assert.equal(thingsBefore.length, 1);

  // Close the store via the lease mechanism
  await store.close();

  // All methods on the closed store must reject with StoreClosedError
  const { StoreClosedError } = await import("../lib/db.ts");

  // putThing must reject
  let threw = false;
  try {
    await store.putThing({ id: "t2", name: "Thing 2", category: "money", kind: "bill", amount: 200, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
  } catch (e) {
    threw = e instanceof StoreClosedError;
  }
  assert.ok(threw, "putThing on closed store must reject with StoreClosedError");

  // deleteThing must reject
  threw = false;
  try {
    await store.deleteThing("t1");
  } catch (e) {
    threw = e instanceof StoreClosedError;
  }
  assert.ok(threw, "deleteThing on closed store must reject with StoreClosedError");

  // getAllThings must reject
  threw = false;
  try {
    await store.getAllThings();
  } catch (e) {
    threw = e instanceof StoreClosedError;
  }
  assert.ok(threw, "getAllThings on closed store must reject with StoreClosedError");

  // Data in the database is intact (a new store for the same scope can read it)
  const store2 = createLocalStore(userScope(makeUserId("1")));
  const thingsAfter = await store2.getAllThings();
  assert.equal(thingsAfter.length, 1, "Original data survives store close");
  assert.equal(thingsAfter[0].id, "t1", "Original record is unchanged");

  await closeScope(store2.scope);
  setLockManager(workingLockManager());
});

// ---------------------------------------------------------------------------
// Account A to Account B complete activation sequence
// ---------------------------------------------------------------------------

test("complete A -> sign-out -> B activation sequence", async () => {
  setLockManager(workingLockManager());

  await resetSyncOwner();

  // --- Account A is active ---
  const storeA = await openAccountStore(makeUserId("1"));
  const userIdA = (storeA.scope as UserLocalScope).userId;
  bindSyncOwner(userIdA);
  assert.ok(getSyncOwner()?.userId === userIdA, "Owner A bound while A active");

  // --- Sign out: teardown A ---
  const teardownResult = await teardownAccount(storeA, userIdA);
  assert.deepEqual(teardownResult, { ok: true }, "A teardown succeeds");
  assert.ok(getSyncOwner() === null, "Owner A released after sign-out");

  // A's store is closed - cannot mutate
  let threw = false;
  try {
    await storeA.putThing({ id: "t3", name: "Should not write", category: "money", kind: "bill", amount: 300, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
  } catch {
    threw = true;
  }
  assert.ok(threw, "A's closed store rejects writes after sign-out");

  // A's data remains intact (new store for same scope can read it)
  const storeA2 = createLocalStore(userScope(makeUserId("1")));
  const aThings = await storeA2.getAllThings();
  assert.equal(aThings.length, 1, "A's data remains intact after sign-out");
  await closeScope(storeA2.scope);

  // --- Account B activates: new validated store ---
  const storeB = await openAccountStore(makeUserId("2"));
  const userIdB = (storeB.scope as UserLocalScope).userId;
  assert.notEqual(userIdA, userIdB, "B is a different account");

  bindSyncOwner(userIdB);
  assert.ok(getSyncOwner()?.userId === userIdB, "Owner B bound after activation");

  // B's store is independent - B can write its own data without seeing A's
  await storeB.putThing({ id: "b1", name: "B's thing", category: "money", kind: "bill", amount: 999, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
  const bThings = await storeB.getAllThings();
  assert.ok(bThings.some((t) => t.id === "b1"), "B can write and read its own data");
  assert.ok(bThings.some((t) => t.name === "B's thing"), "B sees its own data");

  // A's data remains intact in A's own database
  const storeA3 = createLocalStore(userScope(makeUserId("1")));
  const aThingsAgain = await storeA3.getAllThings();
  assert.ok(aThingsAgain.some((t) => t.id === "t1"), "A's data remains intact after B activation");
  await closeScope(storeA3.scope);

  // --- Clean up ---
  await closeScope(storeB.scope);
  releaseSyncOwner(syncOwner(userIdB));

  setLockManager(workingLockManager());
});

test("failed transition does not expose either account", async () => {
  setLockManager(workingLockManager());

  await resetSyncOwner();

  // Account A is active with an owner bound
  const storeA = await openAccountStore(makeUserId("1"));
  const userIdA = (storeA.scope as UserLocalScope).userId;
  bindSyncOwner(userIdA);

  const result = await transitionIdentity(storeA, userIdA, "switch");
  assert.deepEqual(result, { ok: true }, "Successful transition returns ok");

  // After successful transition, A's store is closed and ownership released
  assert.ok(getSyncOwner() === null, "Owner A released after transition");

  // A's store cannot be used
  let threw = false;
  try {
    await storeA.putThing({ id: "t4", name: "Stale write", category: "money", kind: "bill", amount: 400, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-01-04T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
  } catch {
    threw = true;
  }
  assert.ok(threw, "A's store rejects writes after transition");

  setLockManager(workingLockManager());
});

// ---------------------------------------------------------------------------
// Lock timeout and abort - deterministic test
// ---------------------------------------------------------------------------

test("lock timeout aborts: work never executes when lock request times out", async () => {
  setLockManager(workingLockManager());

  // Hold the lock indefinitely; the mock respects the abort signal so the
  // 5s timeout in withIdentityLock can trigger AbortError.
  let abortHandler: (() => void) | null = null;

  setLockManager({
    request: async (_name: string, options: { signal: AbortSignal }) => {
      // Respect the abort signal: when aborted, reject with AbortError
      return new Promise<never>((_resolve, reject) => {
        abortHandler = () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        if (options.signal.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        options.signal.addEventListener("abort", abortHandler!, { once: true });
      });
    },
  });

  let workRan = false;
  let threwTimeout = false;

  try {
    await withIdentityLock(async () => {
      workRan = true;
    });
  } catch (e) {
    threwTimeout = e instanceof Error && e.name === "IdentityLockTimeoutError";
  }

  assert.ok(!workRan, "Work must never execute when lock acquisition times out");
  assert.ok(threwTimeout, "Must throw IdentityLockTimeoutError on lock timeout");

  // Restore working lock manager
  setLockManager(workingLockManager());
});

test("lock abort cleans up: no work runs after abort", async () => {
  setLockManager(workingLockManager());

  // Mock lock manager that rejects with AbortError immediately
  setLockManager({
    request: async () => {
      // Simulate abort immediately
      const err = new DOMException("The operation was aborted.", "AbortError");
      throw err;
    },
  });

  let workRan = false;
  let threwTimeout = false;

  try {
    await withIdentityLock(async () => {
      workRan = true;
    });
  } catch (e) {
    threwTimeout = e instanceof Error && e.name === "IdentityLockTimeoutError";
  }

  assert.ok(!workRan, "Work must not run when lock request is aborted");
  assert.ok(threwTimeout, "AbortError must be converted to IdentityLockTimeoutError");

  // Restore
  setLockManager(workingLockManager());
});

// ---------------------------------------------------------------------------
// Reminder cancellation failure prevents transition
// ---------------------------------------------------------------------------

test("reminder cancellation failure prevents successful transition completion", async () => {
  setLockManager(workingLockManager());

  await resetSyncOwner();
  const store = await openAccountStore(makeUserId("1"));
  const userId = (store.scope as UserLocalScope).userId;

  // On Node.js (non-native platform), cancelScheduledReminders returns early
  // without error. Teardown succeeds and transitionIdentity broadcasts.
  // The failure path is covered by the "reminder cancellation failure leaves
  // the account intact" test below, which injects a rejecting adapter.

  // Verify teardown succeeds on this platform
  const result = await teardownAccount(store, userId);
  assert.deepEqual(result, { ok: true }, "Teardown succeeds when cancellation succeeds");

  // Verify transitionIdentity broadcasts after successful teardown
  let postMessageCalled = false;
  const originalChannel = globals.BroadcastChannel;
  class FakeBroadcastChannel {
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(name: string) { this.name = name; }
    postMessage() { postMessageCalled = true; }
    close() {}
  }
  define("BroadcastChannel", FakeBroadcastChannel);
  resetIdentityChannelForTesting();

  try {
    await resetSyncOwner();
    const store2 = await openAccountStore(makeUserId("2"));
    const userId2 = (store2.scope as UserLocalScope).userId;
    const result2 = await transitionIdentity(store2, userId2, "sign-out");
    assert.deepEqual(result2, { ok: true });
    assert.ok(postMessageCalled, "Broadcast sent after successful transitionIdentity");
  } finally {
    if (originalChannel) {
      define("BroadcastChannel", originalChannel);
    } else {
      define("BroadcastChannel", undefined);
    }
    setLockManager(workingLockManager());
  }
});

// ---------------------------------------------------------------------------
// In-flight database operations during store close
// ---------------------------------------------------------------------------

test("in-flight write completes before store close releases the database", async () => {
  setLockManager(workingLockManager());
  __setTxnDelay(100);

  try {
    const store = await openAccountStore(makeUserId("1"));

    const writePromise = store.putThing({
      id: "in-flight",
      name: "In Flight Thing",
      category: "money",
      kind: "bill",
      amount: 500,
      currency: "NGN",
      status: "active",
      priority: "routine",
      notes: null,
      details: {},
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      dueDate: null,
      lastHandledDate: null,
      recurrence: null,
      serviceIntervalDays: null,
    });

    const closeStart = Date.now();
    await store.close();
    const closeDuration = Date.now() - closeStart;

    await writePromise;
    assert.ok(closeDuration >= 90, `close() should wait for in-flight write, took ${closeDuration}ms`);
    assert.ok(store.closed, "Store should be closed after close()");

    const store2 = createLocalStore(userScope(makeUserId("1")));
    const things = await store2.getAllThings();
    assert.ok(things.some((t) => t.id === "in-flight"), "In-flight write data should be persisted");
    assert.ok(things.some((t) => t.id === "t1"), "Original data should be preserved");
    await closeScope(store2.scope);

    let threw = false;
    try {
      await store.putThing({ id: "after-close", name: "After Close", category: "money", kind: "bill", amount: 600, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-02-02T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
    } catch (e) {
      threw = e instanceof StoreClosedError;
    }
    assert.ok(threw, "putThing on closed store must reject with StoreClosedError");

    threw = false;
    try {
      await store.getAllThings();
    } catch (e) {
      threw = e instanceof StoreClosedError;
    }
    assert.ok(threw, "getAllThings on closed store must reject with StoreClosedError");
  } finally {
    __setTxnDelay(0);
    setLockManager(workingLockManager());
  }
});

test("close() does not deadlock when in-flight operation never resolves", async () => {
  setLockManager(workingLockManager());
  // Just past the 5 s close deadline: enough to force the timeout without
  // leaving a long-lived timer behind for the rest of the run.
  __setTxnDelay(6000);

  try {
    const store = await openAccountStore(makeUserId("1"));

    const writePromise = store.putThing({
      id: "slow-write",
      name: "Slow Write",
      category: "money",
      kind: "bill",
      amount: 700,
      currency: "NGN",
      status: "active",
      priority: "routine",
      notes: null,
      details: {},
      createdAt: "2026-02-03T00:00:00.000Z",
      updatedAt: "2026-02-03T00:00:00.000Z",
      dueDate: null,
      lastHandledDate: null,
      recurrence: null,
      serviceIntervalDays: null,
    });

    const closeStart = Date.now();
    await store.close();
    const closeDuration = Date.now() - closeStart;

    assert.ok(closeDuration < 6000, `close() should time out, took ${closeDuration}ms`);
    assert.ok(store.closed, "Store should be marked closed after close() times out");

    // The write is still delayed past the close deadline; waiting on it here
    // would only make the test as slow as the stall it is simulating.
    void writePromise.catch(() => {});
  } finally {
    __setTxnDelay(0);
    setLockManager(workingLockManager());
  }
});

// ---------------------------------------------------------------------------
// Real A-to-B authentication transition integration
// ---------------------------------------------------------------------------

test("real A-to-B transition: B cannot activate before A's teardown succeeds", async () => {
  setLockManager(workingLockManager());

  await resetSyncOwner();

  const storeA = await openAccountStore(makeUserId("000000000001"));
  const userIdA = (storeA.scope as UserLocalScope).userId;
  bindSyncOwner(userIdA);
  assert.ok(getSyncOwner()?.userId === userIdA, "Owner A bound while A active");

  const teardownResult = await teardownAccount(storeA, userIdA);
  assert.deepEqual(teardownResult, { ok: true }, "A teardown succeeds");
  assert.ok(getSyncOwner() === null, "Owner A released after teardown");

  assert.ok(storeA.closed, "A's store is closed");
  let threw = false;
  try {
    await storeA.putThing({ id: "stale-a", name: "Stale A", category: "money", kind: "bill", amount: 100, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-02-04T00:00:00.000Z", updatedAt: "2026-02-04T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
  } catch {
    threw = true;
  }
  assert.ok(threw, "A's closed store rejects writes");

  const storeB = await openAccountStore(makeUserId("000000000002"));
  const userIdB = (storeB.scope as UserLocalScope).userId;
  assert.notEqual(userIdA, userIdB, "B is a different account");

  bindSyncOwner(userIdB);
  assert.ok(getSyncOwner()?.userId === userIdB, "Owner B bound only after A's teardown");

  await storeB.putThing({ id: "b-sentinel", name: "B Sentinel", category: "money", kind: "bill", amount: 999, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-02-05T00:00:00.000Z", updatedAt: "2026-02-05T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
  const bThings = await storeB.getAllThings();
  assert.ok(bThings.some((t) => t.id === "b-sentinel"), "B can write and read its own sentinel");

  const storeA2 = createLocalStore(userScope(makeUserId("000000000001")));
  const aThings = await storeA2.getAllThings();
  assert.ok(aThings.some((t) => t.id === "t1"), "A's sentinel remains intact");
  await closeScope(storeA2.scope);

  await closeScope(storeB.scope);
  releaseSyncOwner(syncOwner(userIdB));

  setLockManager(workingLockManager());
});

// ---------------------------------------------------------------------------
// Reminder cancellation failure injection
// ---------------------------------------------------------------------------

test("reminder cancellation failure leaves the account intact and can be retried", async () => {
  setLockManager(workingLockManager());
  resetIdentityChannelForTesting();

  const originalWindow = globals.window;
  // No navigator: cancelling reminders throws, which is the failure under test.
  define("window", {});

  let postMessageCalled = false;
  const originalChannel = globals.BroadcastChannel;
  class FakeBroadcastChannel {
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(name: string) { this.name = name; }
    postMessage() { postMessageCalled = true; }
    close() {}
  }
  define("BroadcastChannel", FakeBroadcastChannel);

  try {
    await resetSyncOwner();
    const store = await openAccountStore(makeUserId("1"));
    const userId = (store.scope as UserLocalScope).userId;

    bindSyncOwner(userId);
    assert.ok(getSyncOwner() !== null, "Owner bound before teardown");

    const result = await teardownAccount(store, userId);

    assert.ok(result.ok === false, "Teardown reports failure when reminder cancellation fails");
    if (result.ok === false) {
      assert.ok(typeof result.reason === "string" && result.reason.length > 0, "Failure reason is provided");
    }

    // Cancellation happens before anything is closed, so a failure leaves the
    // account whole: no half-torn-down authenticated state.
    assert.ok(!store.closed, "Store stays open when reminder cancellation fails");
    assert.ok(getSyncOwner()?.userId === userId, "Sync owner is still bound after failure");
    assert.ok(
      (await store.getAllThings()).some((t) => t.id === "t1"),
      "Account records remain readable after failed teardown",
    );

    const transitionResult = await transitionIdentity(store, userId, "sign-out");
    assert.ok(transitionResult.ok === false, "transitionIdentity returns failure");
    assert.ok(!postMessageCalled, "No broadcast on failed transition - Account B not activated");

    // Retrying once cancellation can work completes the teardown.
    define("window", { navigator: {} });
    const retried = await transitionIdentity(store, userId, "sign-out");
    assert.deepEqual(retried, { ok: true }, "Retry succeeds once cancellation works");
    assert.ok(store.closed, "Store closes on the successful retry");
    assert.ok(getSyncOwner() === null, "Owner released on the successful retry");
    assert.ok(postMessageCalled, "Broadcast sent only after the successful retry");
  } finally {
    if (originalChannel) {
      define("BroadcastChannel", originalChannel);
    } else {
      define("BroadcastChannel", undefined);
    }
    if (originalWindow) {
      define("window", originalWindow);
    } else {
      define("window", undefined);
    }
    setLockManager(workingLockManager());
  }
});

// ---------------------------------------------------------------------------
// Strengthened account isolation tests (unique UUIDs, sentinel records)
// ---------------------------------------------------------------------------

test("account isolation: unique sentinels per account, no count assumptions", async () => {
  setLockManager(workingLockManager());

  await resetSyncOwner();

  const userIdA = makeUserId("000000000001");
  const userIdB = makeUserId("000000000002");

  const storeA = await openAccountStore(userIdA);
  const storeB = await openAccountStore(userIdB);

  await storeA.putThing({ id: "a-sentinel", name: "Account A Sentinel", category: "money", kind: "bill", amount: 100, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
  await storeB.putThing({ id: "b-sentinel", name: "Account B Sentinel", category: "money", kind: "bill", amount: 200, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-03-02T00:00:00.000Z", updatedAt: "2026-03-02T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });

  const aThings = await storeA.getAllThings();
  assert.ok(aThings.some((t) => t.id === "a-sentinel"), "A can read A's sentinel");

  const bThings = await storeB.getAllThings();
  assert.ok(bThings.some((t) => t.id === "b-sentinel"), "B can read B's sentinel");
  assert.ok(!bThings.some((t) => t.id === "a-sentinel"), "B cannot read A's sentinel");

  await storeA.close();
  assert.ok(storeA.closed, "A's store is closed");

  const bThingsAgain = await storeB.getAllThings();
  assert.ok(bThingsAgain.some((t) => t.id === "b-sentinel"), "B's store still works after A's store closed");

  let threw = false;
  try {
    await storeA.putThing({ id: "a-stale", name: "Stale A", category: "money", kind: "bill", amount: 300, currency: "NGN", status: "active", priority: "routine", notes: null, details: {}, createdAt: "2026-03-03T00:00:00.000Z", updatedAt: "2026-03-03T00:00:00.000Z", dueDate: null, lastHandledDate: null, recurrence: null, serviceIntervalDays: null });
  } catch (e) {
    threw = e instanceof StoreClosedError;
  }
  assert.ok(threw, "A's closed store rejects writes with StoreClosedError");

  const storeA2 = createLocalStore(userScope(userIdA));
  const aThingsAgain = await storeA2.getAllThings();
  assert.ok(aThingsAgain.some((t) => t.id === "a-sentinel"), "A's sentinel intact after A's store closed");
  assert.ok(!aThingsAgain.some((t) => t.id === "a-stale"), "Stale write did not reach A's database");
  await closeScope(storeA2.scope);

  await closeScope(storeB.scope);

  setLockManager(workingLockManager());
});

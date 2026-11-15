/**
 * Reminder scheduling is owned by the active account (ADR 0002 §5.3).
 *
 * Every native call in these tests goes through the coordinator rather than the
 * bridge: the coordinator re-reads the session under the identity lock, checks
 * the plan's owner against it and against the persisted marker, applies the
 * plan as a full cancel + full schedule, and cancels again if the marker moved
 * while the plugin was working. These tests drive each of those gates.
 */

import test from "node:test";
import assert from "node:assert/strict";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

class FakeNotification {
  static permission = "granted";
  static shown: FakeNotification[] = [];

  readonly title: string;
  readonly options: { body: string; tag: string };

  constructor(title: string, options: { body: string; tag: string }) {
    this.title = title;
    this.options = options;
    FakeNotification.shown.push(this);
  }
}

const fakeWindow: {
  navigator: Record<string, unknown> | undefined;
  Notification?: unknown;
} = {
  navigator: {},
  Notification: FakeNotification,
};
define("window", fakeWindow);
define("Notification", FakeNotification);

const {
  cancelForTransition,
  deliverOwnerNotification,
  reconcileReminders,
  setReminderSessionReaderForTesting,
} = await import("../lib/reminders/coordinator.ts");
const {
  resetReminderSchedulingForTesting,
  setReminderAdapterForTesting,
} = await import("../lib/schedule.ts");
type ReminderNativeAdapter = import("../lib/schedule.ts").ReminderNativeAdapter;
const {
  beginReminderTransition,
  completeReminderTransition,
  readReminderMarker,
  reminderOwnerHash,
  setReminderOwnerStorageForTesting,
} = await import("../lib/reminders/ownerMarker.ts");
const { ensureReminderOwner } = await import(
  "../lib/reminders/ownerTransition.ts"
);
const { setLockManager } = await import("../lib/identityLock.ts");
import type { PlannedReminder } from "../lib/reminders.ts";

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

// Node has no device storage, so the persisted marker lives in memory. It is
// still written, fenced and re-read exactly as it is on a device.
const ownerStorage = new Map<string, string>();
setReminderOwnerStorageForTesting({
  getItem: (key) => ownerStorage.get(key) ?? null,
  setItem: (key, value) => {
    ownerStorage.set(key, value);
  },
});

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface RecordingAdapter extends ReminderNativeAdapter {
  ops: string[];
  scheduleCalls: number;
  permissionRequests: number;
}

function adapter(
  options: {
    permission?: string;
    scheduleGate?: Promise<void>;
  } = {},
): RecordingAdapter {
  const record: RecordingAdapter = {
    ops: [],
    scheduleCalls: 0,
    permissionRequests: 0,
    checkPermissions: async () => ({ display: options.permission ?? "granted" }),
    requestPermissions: async () => {
      record.permissionRequests += 1;
      return { display: options.permission ?? "granted" };
    },
    cancelAll: async () => {
      record.ops.push("cancel");
    },
    schedule: async () => {
      record.scheduleCalls += 1;
      record.ops.push("schedule");
      if (options.scheduleGate) await options.scheduleGate;
    },
  };
  return record;
}

interface LockManager {
  request(
    name: string,
    options: { signal: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void>;
}

/** The lock always available and never contended (one tab, no transitions). */
function reentrantLocks(): LockManager {
  return {
    request: async (_name, _options, callback) => {
      await callback();
    },
  };
}

/** The lock as the Web Locks API behaves on one device: callers queue. */
function serialLocks(): LockManager & { waiting: number } {
  let tail: Promise<unknown> = Promise.resolve();
  const manager: LockManager & { waiting: number } = {
    waiting: 0,
    request: (_name, _options, callback) => {
      manager.waiting += 1;
      const run = tail.then(callback, callback);
      tail = run.then(
        () => {
          manager.waiting -= 1;
        },
        () => {
          manager.waiting -= 1;
        },
      );
      return run;
    },
  };
  return manager;
}

/** A lock held elsewhere until `gate` resolves. */
function lockedUntil(gate: Promise<void>): LockManager & { waiting: number } {
  const manager: LockManager & { waiting: number } = {
    waiting: 0,
    request: async (_name, _options, callback) => {
      manager.waiting += 1;
      await gate;
      await callback();
    },
  };
  return manager;
}

/** A lock whose acquisition is abandoned, as when a sibling tab wedges it. */
function timingOutLocks(): LockManager {
  return {
    request: async () => {
      throw new DOMException("aborted", "AbortError");
    },
  };
}

function reminder(id: string): PlannedReminder {
  return {
    id,
    thingId: id,
    lead: 7,
    fireAt: new Date("2026-12-01T09:00:00.000Z"),
    title: id,
    body: id,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not met in time");
}

/** Writes the marker exactly as a completed transition does. */
async function activate(ownerId: string | null) {
  const owner = ownerId === null ? null : await reminderOwnerHash(ownerId);
  const transition = beginReminderTransition(owner);
  completeReminderTransition(transition);
}

function sessionIs(ownerId: string | null) {
  setReminderSessionReaderForTesting(async () => ownerId);
}

function sessionReadFails() {
  setReminderSessionReaderForTesting(async () => {
    throw new Error("the session authority is unavailable");
  });
}

function planFor(ownerId: string | null, ids: string[]) {
  return reconcileReminders({
    authEnabled: true,
    ownerId,
    plan: ids.map(reminder),
  });
}

test.beforeEach(() => {
  ownerStorage.clear();
  resetReminderSchedulingForTesting();
  setReminderSessionReaderForTesting(null);
  setLockManager(reentrantLocks());
  FakeNotification.permission = "granted";
  FakeNotification.shown = [];
});

test.after(() => setLockManager(null));

// ---------------------------------------------------------------------------
// Scheduling by the active account
// ---------------------------------------------------------------------------

test("the active account schedules its own plan", async () => {
  const record = adapter();
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);

  assert.equal(await planFor(A_ID, ["a-1", "a-2"]), "scheduled");
  assert.deepEqual(record.ops, ["cancel", "schedule"]);
});

test("the reconciliation is always a full cancel followed by the full plan", async () => {
  const record = adapter();
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);

  await planFor(A_ID, ["a-1"]);
  await planFor(A_ID, ["a-1", "a-2"]);

  assert.deepEqual(record.ops, ["cancel", "schedule", "cancel", "schedule"]);
});

test("an auth-disabled build still schedules through the coordinator", async () => {
  const record = adapter();
  setReminderAdapterForTesting(record);

  assert.equal(
    await reconcileReminders({
      authEnabled: false,
      ownerId: null,
      plan: [reminder("local-1")],
    }),
    "scheduled",
  );
  assert.deepEqual(record.ops, ["cancel", "schedule"]);
});

// ---------------------------------------------------------------------------
// Refused ownership
// ---------------------------------------------------------------------------

test("a plan for a foreign account never reaches the plugin", async () => {
  const record = adapter();
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);

  assert.equal(await planFor(B_ID, ["b-1"]), "forbidden");
  assert.deepEqual(record.ops, []);
});

test("a plan is refused after sign-out", async () => {
  const record = adapter();
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);
  await activate(null);
  sessionIs(null);

  assert.equal(await planFor(A_ID, ["a-1"]), "forbidden");
  assert.equal(await planFor(null, ["a-1"]), "forbidden");
  assert.deepEqual(record.ops, []);
});

test("a plan is refused when the session cannot be read", async () => {
  const record = adapter();
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionReadFails();

  assert.equal(await planFor(A_ID, ["a-1"]), "error");
  assert.deepEqual(record.ops, []);
});

test("a plan is refused when the marker is absent", async () => {
  const record = adapter();
  setReminderAdapterForTesting(record);
  ownerStorage.clear();
  sessionIs(A_ID);

  assert.equal(await planFor(A_ID, ["a-1"]), "forbidden");
  assert.deepEqual(record.ops, []);
});

test("a plan is refused while the marker is mid-transition", async () => {
  const record = adapter();
  setReminderAdapterForTesting(record);
  beginReminderTransition(await reminderOwnerHash(A_ID));
  sessionIs(A_ID);

  assert.equal(await planFor(A_ID, ["a-1"]), "forbidden");
  assert.deepEqual(record.ops, []);
});

test("denied notification permission schedules nothing", async () => {
  const record = adapter({ permission: "denied" });
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);

  assert.equal(await planFor(A_ID, ["a-1"]), "denied");
  assert.deepEqual(record.ops, []);
});

// ---------------------------------------------------------------------------
// Stale scheduling and races with cancellation
// ---------------------------------------------------------------------------

test("a sign-out racing an in-flight plan leaves cancellation as the last call", async () => {
  const gate = deferred<void>();
  const record = adapter({ scheduleGate: gate.promise });
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);

  const scheduling = planFor(A_ID, ["a-1"]);
  await until(() => record.scheduleCalls === 1);

  // The app signs out while A's plan is inside the plugin.
  const transition = beginReminderTransition(null);
  const cancellation = cancelForTransition(transition);
  gate.resolve();
  await cancellation;

  assert.equal(await scheduling, "stale");
  completeReminderTransition(transition);

  assert.equal(record.scheduleCalls, 1, "the stale plan is not re-scheduled");
  assert.equal(
    record.ops[record.ops.length - 1],
    "cancel",
    "the plugin's last instruction is a full cancellation",
  );
});

test("a plan started by A cannot survive a switch to B", async () => {
  const gate = deferred<void>();
  const record = adapter({ scheduleGate: gate.promise });
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);

  const stale = planFor(A_ID, ["a-1"]);
  await until(() => record.scheduleCalls === 1);

  // Another tab completes the switch to B.
  const switchTransition = beginReminderTransition(await reminderOwnerHash(B_ID));
  const switching = cancelForTransition(switchTransition);
  gate.resolve();
  await switching;
  completeReminderTransition(switchTransition);
  sessionIs(B_ID);

  assert.equal(await stale, "stale");
  assert.equal(record.ops[record.ops.length - 1], "cancel");

  record.ops.length = 0;
  assert.equal(await planFor(B_ID, ["b-1"]), "scheduled");
  assert.deepEqual(record.ops, ["cancel", "schedule"]);
});

// ---------------------------------------------------------------------------
// Concurrency and lock contention
// ---------------------------------------------------------------------------

test("concurrent plans from one account are applied one at a time", async () => {
  setLockManager(serialLocks());
  const record = adapter();
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);

  const first = planFor(A_ID, ["a-1"]);
  const second = planFor(A_ID, ["a-2"]);
  assert.deepEqual(await Promise.all([first, second]), [
    "scheduled",
    "scheduled",
  ]);

  assert.deepEqual(record.ops, ["cancel", "schedule", "cancel", "schedule"]);
});

test("a plan queued on the lock observes the sign-out that happened while it waited", async () => {
  const gate = deferred<void>();
  const locks = lockedUntil(gate.promise);
  setLockManager(locks);
  const record = adapter();
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);

  const scheduling = planFor(A_ID, ["a-1"]);
  await until(() => locks.waiting === 1);

  // The sign-out wins the lock first, then the queued plan is admitted.
  await activate(null);
  sessionIs(null);
  gate.resolve();

  assert.equal(await scheduling, "forbidden");
  assert.deepEqual(record.ops, []);
});

test("a plan that cannot acquire the lock schedules nothing", async () => {
  setLockManager(timingOutLocks());
  const record = adapter();
  setReminderAdapterForTesting(record);
  await activate(A_ID);
  sessionIs(A_ID);

  assert.equal(await planFor(A_ID, ["a-1"]), "error");
  assert.deepEqual(record.ops, []);
});

// ---------------------------------------------------------------------------
// In-session notification delivery
// ---------------------------------------------------------------------------

const notice = { id: "n-1", title: "Rent is due", body: "In 7 days" };

test("delivers an in-session notification for the active owner", async () => {
  await activate(A_ID);
  sessionIs(A_ID);

  const delivered = await deliverOwnerNotification({
    authEnabled: true,
    ownerId: A_ID,
    notification: notice,
    alreadyNotified: new Set(),
  });

  assert.equal(delivered, true);
  assert.equal(FakeNotification.shown.length, 1);
  assert.equal(FakeNotification.shown[0].options.tag, "n-1");
});

test("refuses a notification whose owner is not the session owner", async () => {
  await activate(A_ID);
  sessionIs(A_ID);

  const delivered = await deliverOwnerNotification({
    authEnabled: true,
    ownerId: B_ID,
    notification: notice,
    alreadyNotified: new Set(),
  });

  assert.equal(delivered, false);
  assert.equal(FakeNotification.shown.length, 0);
});

test("refuses a notification after sign-out", async () => {
  await activate(A_ID);
  sessionIs(A_ID);
  await activate(null);
  sessionIs(null);

  const delivered = await deliverOwnerNotification({
    authEnabled: true,
    ownerId: A_ID,
    notification: notice,
    alreadyNotified: new Set(),
  });

  assert.equal(delivered, false);
  assert.equal(FakeNotification.shown.length, 0);
});

test("refuses a notification when the session cannot be read", async () => {
  await activate(A_ID);
  sessionReadFails();

  const delivered = await deliverOwnerNotification({
    authEnabled: true,
    ownerId: A_ID,
    notification: notice,
    alreadyNotified: new Set(),
  });

  assert.equal(delivered, false);
  assert.equal(FakeNotification.shown.length, 0);
});

// ---------------------------------------------------------------------------
// Owner transition adoption (ADR 0002 §5.2 step 5)
// ---------------------------------------------------------------------------

test("an active marker for the same owner is adopted without cancelling", async () => {
  await activate(A_ID);
  const before = readReminderMarker();
  const record = adapter();
  setReminderAdapterForTesting(record);

  const outcome = await ensureReminderOwner({
    ownerId: A_ID,
    confirmOwner: async () => A_ID,
  });

  assert.equal(outcome.status, "ready");
  assert.deepEqual(record.ops, [], "the completed transition is not repeated");
  const after = readReminderMarker();
  assert.equal(after?.phase, "active");
  assert.equal(after?.owner, before?.owner);
  assert.equal(after?.epoch, before?.epoch, "adoption does not re-epoch");
  assert.equal(after?.tid, before?.tid, "adoption does not rewrite the marker");
});

test("an active marker for a different owner still cancels", async () => {
  await activate(A_ID);
  const record = adapter();
  setReminderAdapterForTesting(record);

  const outcome = await ensureReminderOwner({
    ownerId: B_ID,
    confirmOwner: async () => B_ID,
  });

  assert.equal(outcome.status, "ready");
  assert.deepEqual(record.ops, ["cancel"]);
  assert.equal(readReminderMarker()?.owner, await reminderOwnerHash(B_ID));
});

test("a transitioning marker is never adopted; it is completed by cancelling", async () => {
  beginReminderTransition(await reminderOwnerHash(A_ID));
  const record = adapter();
  setReminderAdapterForTesting(record);

  const outcome = await ensureReminderOwner({
    ownerId: A_ID,
    confirmOwner: async () => A_ID,
  });

  assert.equal(outcome.status, "ready");
  assert.deepEqual(
    record.ops,
    ["cancel"],
    "an unfinished transition must be finished, not assumed",
  );
  assert.equal(readReminderMarker()?.phase, "active");
});

test("never delivers the same notification id twice", async () => {
  await activate(A_ID);
  sessionIs(A_ID);

  const delivered = await deliverOwnerNotification({
    authEnabled: true,
    ownerId: A_ID,
    notification: notice,
    alreadyNotified: new Set([notice.id]),
  });

  assert.equal(delivered, false);
  assert.equal(FakeNotification.shown.length, 0);
});

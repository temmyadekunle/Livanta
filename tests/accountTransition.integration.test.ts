/**
 * A -> sign-out -> B, end to end through the coordinator and the real stores.
 *
 * This is the account-isolation path the remediation is about: the outgoing
 * account's reminders are cancelled before anything else, its store is closed,
 * B never activates while that has not succeeded, and B's records never include
 * anything from A. The native plugin is replaced with a recording adapter so
 * the cancellation and scheduling calls are asserted rather than assumed.
 */

import test from "node:test";
import assert from "node:assert/strict";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

define("window", { navigator: {} });

const fake = await import("fake-indexeddb");
define("indexedDB", fake.indexedDB);
define("IDBKeyRange", fake.IDBKeyRange);

const { createLocalStore, userScope } = await import("../lib/db.ts");
const { setLockManager } = await import("../lib/identityLock.ts");
const { resetIdentityChannelForTesting } = await import(
  "../lib/identityTransition.ts"
);
const { createAccountTransitionCoordinator } = await import("../lib/accountTransition.ts");
const {
  setReminderAdapterForTesting,
  resetReminderSchedulingForTesting,
} = await import("../lib/schedule.ts");
const { reconcileReminders, setReminderSessionReaderForTesting } = await import(
  "../lib/reminders/coordinator.ts"
);
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import("../lib/settings.ts");
const {
  beginReminderTransition,
  completeReminderTransition,
  reminderOwnerHash,
  setReminderOwnerStorageForTesting,
} = await import("../lib/reminders/ownerMarker.ts");
const { makeAlert } = await import("./helpers.ts");
import type { PlannedReminder } from "../lib/reminders.ts";

// No browser here, so the device marker lives in memory. The teardown path
// still publishes `transitioning` before cancelling and `active` only after.
const ownerStorage = new Map<string, string>();
setReminderOwnerStorageForTesting({
  getItem: (key) => ownerStorage.get(key) ?? null,
  setItem: (key, value) => {
    ownerStorage.set(key, value);
  },
});
test.beforeEach(() => ownerStorage.clear());

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const C_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const D_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";

test.after(() => {
  resetIdentityChannelForTesting();
  setReminderSessionReaderForTesting(null);
});

/**
 * Establishes `userId` as the reminder owner, standing in for the activation
 * barrier the app runs before it publishes an account.
 */
async function establishOwner(userId: string): Promise<void> {
  setReminderSessionReaderForTesting(async () => userId);
  completeReminderTransition(
    beginReminderTransition(await reminderOwnerHash(userId)),
  );
}

function workingLock() {
  return {
    request: async (
      _name: string,
      _options: { signal: AbortSignal },
      callback: () => Promise<void>,
    ) => {
      await callback();
    },
  };
}

function thing(id: string, name: string) {
  return {
    id,
    name,
    category: "money" as const,
    kind: "bill" as const,
    amount: 100,
    currency: "NGN" as const,
    status: "active" as const,
    priority: "routine" as const,
    notes: null,
    details: {},
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    dueDate: null,
    lastHandledDate: null,
    recurrence: null,
    serviceIntervalDays: null,
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

function recordingAdapter() {
  const scheduled: string[][] = [];
  const adapter = {
    ops: [] as string[],
    scheduled,
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    cancelAll: async () => {
      adapter.ops.push("cancel");
    },
    schedule: async (options: { notifications: { title: string }[] }) => {
      adapter.ops.push("schedule");
      scheduled.push(options.notifications.map((n) => n.title));
    },
  };
  return adapter;
}

test("signing out of A clears A's reminders and store before B can start", async () => {
  setLockManager(workingLock());
  resetReminderSchedulingForTesting();
  const adapter = recordingAdapter();
  setReminderAdapterForTesting(adapter);

  const coordinator = createAccountTransitionCoordinator();
  const storeA = createLocalStore(userScope(A_ID));
  await storeA.putThing(thing("a-secret", "A secret bill"));
  await saveSettings(storeA, {
    ...DEFAULT_SETTINGS,
    onboarded: true,
    displayName: "Account A",
    avatar: "",
  });
  await storeA.putAlert(
    makeAlert({ id: "a-alert", title: "A private alert", dismissed: false }),
  );

  coordinator.signedIn(A_ID, storeA);
  await establishOwner(A_ID);
  assert.equal(
    await reconcileReminders({
      authEnabled: true,
      ownerId: A_ID,
      plan: [reminder("a-reminder")],
    }),
    "scheduled",
  );
  assert.deepEqual(adapter.scheduled, [["a-reminder"]]);

  const result = await coordinator.signOut("sign-out");
  assert.deepEqual(result, { ok: true });

  assert.equal(storeA.closed, true, "A's store is closed by teardown");
  assert.equal(adapter.ops.at(-1), "cancel", "reminders are cancelled last");

  await assert.rejects(storeA.putThing(thing("late-a", "Late A")));

  // B starts from its own store; nothing of A's is visible there.
  const storeB = createLocalStore(userScope(B_ID));
  coordinator.signedIn(B_ID, storeB);
  await storeB.putThing(thing("b-secret", "B private bill"));
  await establishOwner(B_ID);
  assert.equal(
    await reconcileReminders({
      authEnabled: true,
      ownerId: B_ID,
      plan: [reminder("b-reminder")],
    }),
    "scheduled",
  );
  assert.deepEqual(
    adapter.scheduled,
    [["a-reminder"], ["b-reminder"]],
    "A's plan is replaced by B's, never merged",
  );

  const bIds = (await storeB.getAllThings()).map((item) => item.id);
  assert.deepEqual(bIds, ["b-secret"], "B sees only its own records");
  assert.deepEqual(await storeB.getAllAlerts(), [], "A's alerts are not visible to B");
  const bSettings = await loadSettings(storeB);
  assert.equal(bSettings.displayName, "", "A's profile is not visible to B");
  assert.equal(bSettings.onboarded, false);

  // A's data was not deleted by the teardown, only released.
  const reopenedA = createLocalStore(userScope(A_ID));
  assert.deepEqual(
    (await reopenedA.getAllThings()).map((item) => item.id),
    ["a-secret"],
  );
  assert.equal((await loadSettings(reopenedA)).displayName, "Account A");
  await reopenedA.close();
  await storeB.close();
  resetReminderSchedulingForTesting();
  setLockManager(workingLock());
});

test("a failed reminder cancellation blocks B and is recoverable", async () => {
  setLockManager(workingLock());
  resetReminderSchedulingForTesting();

  const adapter = recordingAdapter();
  let failCancellation = true;
  setReminderAdapterForTesting({
    ...adapter,
    cancelAll: async () => {
      if (failCancellation) throw new Error("plugin refused");
      adapter.ops.push("cancel");
    },
  });

  const coordinator = createAccountTransitionCoordinator();
  const storeC = createLocalStore(userScope(C_ID));
  await storeC.putThing(thing("c-secret", "C secret bill"));

  coordinator.signedIn(C_ID, storeC);

  const failed = await coordinator.signOut("sign-out");
  assert.equal(failed.ok, false, "B must not activate over A's live reminders");
  assert.equal(storeC.closed, false, "A's store is untouched after a failed teardown");
  assert.equal(coordinator.currentUserId(), C_ID);

  // Retry once the plugin responds: the same session completes, then B starts.
  failCancellation = false;
  const retried = await coordinator.signOut("sign-out");
  assert.deepEqual(retried, { ok: true });
  assert.equal(storeC.closed, true);

  const storeD = createLocalStore(userScope(D_ID));
  coordinator.signedIn(D_ID, storeD);
  assert.equal(coordinator.currentUserId(), D_ID);
  assert.deepEqual(await storeD.getAllThings(), []);
  await storeD.close();

  resetReminderSchedulingForTesting();
  setLockManager(workingLock());
});

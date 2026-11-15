/**
 * Account transition coordinator.
 *
 * The coordinator is what replaced the permanent "teardown already started"
 * latch. These tests pin the properties that latch lacked: every session gets
 * one teardown, duplicate signals share it, failures can be retried, and a
 * finished teardown never suppresses the next session.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createAccountTransitionCoordinator } from "../lib/accountTransition.ts";
import type { LocalStore } from "../lib/db.ts";
import type {
  IdentityReason,
  TeardownResult,
} from "../lib/identityTransition.ts";

const storeFor = (tag: string) => ({ tag } as unknown as LocalStore);

interface Recorded {
  userId: string;
  store: LocalStore | null;
  reason: IdentityReason;
  broadcast: boolean;
}

function recordingCoordinator(
  results: TeardownResult[] = [{ ok: true }],
) {
  const calls: Recorded[] = [];
  let index = 0;
  const coordinator = createAccountTransitionCoordinator({
    transition: async (store, userId, reason, broadcast) => {
      calls.push({ store, userId, reason, broadcast });
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      return result;
    },
  });
  return { coordinator, calls };
}

test("a sign-out with no recorded session does nothing", async () => {
  const { coordinator, calls } = recordingCoordinator();
  const result = await coordinator.signOut("sign-out");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 0);
  assert.equal(coordinator.currentUserId(), null);
});

test("duplicate requests for one session share a single teardown", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const coordinator = createAccountTransitionCoordinator({
    transition: async () => {
      calls += 1;
      await gate;
      return { ok: true };
    },
  });

  coordinator.signedIn("user-a", storeFor("a"));
  const first = coordinator.signOut("sign-out");
  const second = coordinator.signOut("sign-out");
  release();

  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await second, { ok: true });
  assert.equal(calls, 1, "one session must be torn down once");
  assert.ok(first === second, "callers receive the same operation");
});

test("a completed sign-out does not suppress a later session's teardown", async () => {
  const { coordinator, calls } = recordingCoordinator();
  const first = storeFor("a1");
  const second = storeFor("a2");

  coordinator.signedIn("user-a", first);
  assert.deepEqual(await coordinator.signOut("sign-out"), { ok: true });

  // The same account signing in again is a new session with a new store.
  coordinator.signedIn("user-a", second);
  assert.deepEqual(await coordinator.signOut("sign-out"), { ok: true });

  assert.equal(calls.length, 2, "each session gets its own teardown");
  assert.equal(calls[0].store, first);
  assert.equal(calls[1].store, second);
});

test("a session expiry after a successful teardown still tears down", async () => {
  const { coordinator, calls } = recordingCoordinator();

  coordinator.signedIn("user-a", storeFor("a"));
  await coordinator.signOut("sign-out");

  coordinator.signedIn("user-b", storeFor("b"));
  const result = await coordinator.signOut("sign-out");

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(
    calls.map((call) => call.userId),
    ["user-a", "user-b"],
  );
});

test("a finished session is not torn down twice", async () => {
  const { coordinator, calls } = recordingCoordinator();

  coordinator.signedIn("user-a", storeFor("a"));
  await coordinator.signOut("sign-out");
  await coordinator.signOut("sign-out");

  assert.equal(calls.length, 1);
  assert.equal(coordinator.currentUserId(), "user-a");
});

test("a failed teardown can be retried and is never treated as final", async () => {
  const { coordinator, calls } = recordingCoordinator([
    { ok: false, reason: "reminders still scheduled" },
    { ok: true },
  ]);

  coordinator.signedIn("user-a", storeFor("a"));
  const failed = await coordinator.signOut("sign-out");
  assert.equal(failed.ok, false);
  assert.equal(calls.length, 1);

  const retried = await coordinator.signOut("sign-out");
  assert.deepEqual(retried, { ok: true });
  assert.equal(calls.length, 2, "the failed attempt must not block the retry");

  // Successful retry is final for that session.
  await coordinator.signOut("sign-out");
  assert.equal(calls.length, 2);
});

test("a rejected transition is reported as a failure, not thrown at the caller", async () => {
  const coordinator = createAccountTransitionCoordinator({
    transition: async () => {
      throw new Error("lock unavailable");
    },
  });

  coordinator.signedIn("user-a", storeFor("a"));
  const result = await coordinator.signOut("sign-out");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /lock unavailable/);
  }
});

test("a remote transition is not rebroadcast", async () => {
  const { coordinator, calls } = recordingCoordinator();

  coordinator.signedIn("user-a", storeFor("a"));
  await coordinator.signOut("switch", { broadcast: false });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].broadcast, false);
  assert.equal(calls[0].reason, "switch");
});

test("a local transition broadcasts by default", async () => {
  const { coordinator, calls } = recordingCoordinator();

  coordinator.signedIn("user-a", storeFor("a"));
  await coordinator.signOut("sign-out");

  assert.equal(calls[0].broadcast, true);
});

test("the recorded store is the one currently displayed", async () => {
  const first = storeFor("first");
  const second = storeFor("second");
  const { coordinator } = recordingCoordinator();

  coordinator.signedIn("user-a", first);
  assert.equal(coordinator.currentStore(), first);

  coordinator.signedIn("user-a", second);
  assert.equal(coordinator.currentStore(), second, "same session tracks the store");
  assert.equal(coordinator.currentUserId(), "user-a");
});

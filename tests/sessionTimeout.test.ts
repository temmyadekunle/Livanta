import test from "node:test";
import assert from "node:assert/strict";

import {
  SessionTimeoutError,
  createSessionAttempts,
  withTimeout,
} from "../lib/sessionTimeout.ts";

test("a session read that settles in time keeps its value", async () => {
  const value = await withTimeout(Promise.resolve("session"), 50);
  assert.equal(value, "session");
});

test("a failed session read rejects with the original error", async () => {
  const failure = new Error("storage unavailable");
  await assert.rejects(withTimeout(Promise.reject(failure), 50), failure);
});

test("a session read that never settles times out", async () => {
  const never = new Promise<string>(() => {});
  await assert.rejects(withTimeout(never, 10), SessionTimeoutError);
});

test("a late settlement after a timeout is consumed, not surfaced", async () => {
  let settle: (value: string) => void = () => {};
  const late = new Promise<string>((resolve) => {
    settle = resolve;
  });

  await assert.rejects(withTimeout(late, 5), SessionTimeoutError);

  // Resolving afterwards must neither throw nor leave an unhandled rejection.
  settle("too late");
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("a newer attempt makes an earlier read stale", () => {
  const attempts = createSessionAttempts();

  const first = attempts.begin();
  assert.equal(attempts.current(first), true);

  const second = attempts.begin();
  assert.equal(attempts.current(first), false);
  assert.equal(attempts.current(second), true);

  attempts.invalidate();
  assert.equal(attempts.current(second), false);
});

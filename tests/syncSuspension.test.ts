/**
 * Sync suspension is a pure decision, so these tests need no IndexedDB writes:
 * they cover every state that must stop a cycle before it touches a store or
 * the network, and the one state that may proceed.
 */

import test from "node:test";

import type { AuthStatus } from "../lib/useAuth.ts";
import { assert } from "./helpers.ts";

const {
  anonymousScope,
  createLocalStore,
  userScope,
} = await import("../lib/db.ts");
const { resolveSyncSuspension } = await import("../lib/sync/suspension.ts");

const ACCOUNT = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";

function reason(
  enabled: boolean,
  status: AuthStatus,
  userId: string | null,
  store: ReturnType<typeof createLocalStore> | null,
) {
  const result = resolveSyncSuspension({ enabled, status, userId, store });
  return result.suspended ? result.reason : null;
}

test("a signed-in account with its own store is allowed to sync", () => {
  const store = createLocalStore(userScope(ACCOUNT));
  const result = resolveSyncSuspension({
    enabled: true,
    status: "signed-in",
    userId: ACCOUNT,
    store,
  });

  assert.equal(result.suspended, false);
  if (!result.suspended) assert.equal(result.owner.userId, ACCOUNT);
});

test("an uppercase session id still matches its normalised store", () => {
  const store = createLocalStore(userScope(ACCOUNT));
  const result = resolveSyncSuspension({
    enabled: true,
    status: "signed-in",
    userId: ACCOUNT.toUpperCase(),
    store,
  });

  assert.equal(result.suspended, false);
  if (!result.suspended) assert.equal(result.owner.userId, ACCOUNT);
});

test("a disabled build never syncs", () => {
  const store = createLocalStore(userScope(ACCOUNT));
  assert.equal(
    reason(false, "disabled", ACCOUNT, store),
    "sync-disabled",
  );
  assert.equal(
    reason(true, "disabled", ACCOUNT, store),
    "sync-disabled",
  );
});

test("auth that is still loading suspends sync", () => {
  const store = createLocalStore(userScope(ACCOUNT));
  assert.equal(reason(true, "loading", null, store), "auth-pending");
});

test("a signed-out session suspends sync", () => {
  const store = createLocalStore(userScope(ACCOUNT));
  assert.equal(reason(true, "signed-out", null, store), "signed-out");
});

test("a signed-in session without a usable id is unresolved", () => {
  const store = createLocalStore(userScope(ACCOUNT));
  for (const userId of [null, "", "not-a-uuid"]) {
    assert.equal(
      reason(true, "signed-in", userId, store),
      "unresolved-session",
    );
  }
});

test("an unknown auth status is unresolved rather than anonymous", () => {
  const store = createLocalStore(userScope(ACCOUNT));
  assert.equal(
    reason(true, "something-new" as AuthStatus, ACCOUNT, store),
    "unresolved-session",
  );
});

test("a missing account store suspends instead of using anonymous data", () => {
  assert.equal(
    reason(true, "signed-in", ACCOUNT, null),
    "store-unavailable",
  );
});

test("the anonymous store is never used as a signed-in fallback", () => {
  const store = createLocalStore(anonymousScope());
  assert.equal(
    reason(true, "signed-in", ACCOUNT, store),
    "store-mismatch",
  );
});

test("a store for another account is a mismatch", () => {
  const store = createLocalStore(userScope(OTHER));
  assert.equal(
    reason(true, "signed-in", ACCOUNT, store),
    "store-mismatch",
  );
});

test("a store whose database name no longer matches its scope is rejected", () => {
  const store = createLocalStore(userScope(ACCOUNT));
  Object.defineProperty(store, "databaseName", { value: "lifedesk" });
  assert.equal(
    reason(true, "signed-in", ACCOUNT, store),
    "store-mismatch",
  );
});

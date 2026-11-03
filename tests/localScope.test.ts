// Focused tests for the pure scope resolver.
//
// The resolver must never touch storage, so indexedDB is replaced with a
// factory that fails if anything opens a database. That makes an accidental
// lookup or write a test failure rather than a silent real-data access.
import test from "node:test";

import { assert } from "./helpers.ts";
import type { AuthScopeInput, LocalScopeResolution } from "../lib/localScope.ts";
import type { AuthStatus } from "../lib/useAuth.ts";
import type { LocalScope } from "../lib/db.ts";

const globals = globalThis as Record<string, unknown>;
let openCalls = 0;
const guardedIndexedDB = {
  open() {
    openCalls += 1;
    throw new Error("the scope resolver must not open a database");
  },
} as unknown as IDBFactory;

Object.defineProperty(globals, "indexedDB", {
  value: guardedIndexedDB,
  writable: true,
  configurable: true,
});

const { resolveLocalScope } = await import("../lib/localScope.ts");
const { databaseNameForScope } = await import("../lib/db.ts");

const USER_ID = "11111111-1111-4111-8111-111111111111";

function scopeOf(result: LocalScopeResolution): LocalScope {
  if (result.status !== "anonymous" && result.status !== "account") {
    assert.fail(`expected a resolved scope, received ${result.status}`);
  }
  return result.scope;
}

test("a disabled build resolves to the anonymous scope", () => {
  const result = resolveLocalScope({ enabled: false, status: "disabled" });

  assert.equal(result.status, "anonymous");
  assert.equal(scopeOf(result).kind, "anonymous");
  assert.equal(databaseNameForScope(scopeOf(result)), "lifedesk");
});

test("a signed-out session resolves to the anonymous scope", () => {
  const result = resolveLocalScope({ enabled: true, status: "signed-out" });

  assert.equal(result.status, "anonymous");
  assert.equal(scopeOf(result).kind, "anonymous");
  assert.equal(databaseNameForScope(scopeOf(result)), "lifedesk");
});

test("a resolving session is pending and never opens a database", () => {
  const before = openCalls;
  const result = resolveLocalScope({ enabled: true, status: "loading" });

  assert.deepEqual(result, { status: "pending" });
  assert.equal(openCalls, before);
});

test("a valid signed-in user resolves to that account's scope", () => {
  const input: AuthScopeInput = {
    enabled: true,
    status: "signed-in",
    userId: USER_ID,
  };
  const result = resolveLocalScope(input);
  const scope = scopeOf(result);

  assert.equal(result.status, "account");
  assert.equal(scope.kind, "user");
  if (scope.kind === "user") assert.equal(scope.userId, USER_ID);
});

test("UUID casing is normalized by the existing user-scope convention", () => {
  const upper = USER_ID.toUpperCase();
  const result = resolveLocalScope({
    enabled: true,
    status: "signed-in",
    userId: upper,
  });
  const scope = scopeOf(result);

  assert.equal(scope.kind, "user");
  if (scope.kind === "user") assert.equal(scope.userId, USER_ID);
  assert.equal(databaseNameForScope(scope), `lifedesk:user:${USER_ID}`);
});

test("a signed-in session without a valid user id is an explicit error", () => {
  const invalidIds: (string | null | undefined)[] = [
    null,
    undefined,
    "",
    "not-a-uuid",
    "11111111-1111-4111-8111-11111111111",
  ];

  for (const userId of invalidIds) {
    const result = resolveLocalScope({
      enabled: true,
      status: "signed-in",
      userId,
    });

    assert.equal(result.status, "error", `id ${String(userId)} was accepted`);
    if (result.status === "error") {
      assert.equal(result.reason, "invalid-user");
    }
  }
});

test("an invalid signed-in state never falls back to anonymous", () => {
  const result = resolveLocalScope({
    enabled: true,
    status: "signed-in",
    userId: "still-not-a-uuid",
  });

  assert.notEqual(result.status, "anonymous");
  assert.equal(result.status, "error");
  assert.equal("scope" in result, false);
});

test("a valid user id does not imply a signed-in session", () => {
  const signedOut = resolveLocalScope({
    enabled: true,
    status: "signed-out",
    userId: USER_ID,
  });
  const loading = resolveLocalScope({
    enabled: true,
    status: "loading",
    userId: USER_ID,
  });

  assert.equal(signedOut.status, "anonymous");
  assert.deepEqual(loading, { status: "pending" });
});

test("an unrecognised auth status is an explicit error", () => {
  const result = resolveLocalScope({
    enabled: true,
    status: "unexpected" as AuthStatus,
  });

  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.reason, "unknown-auth-status");
  }
});

test("resolving scopes has no database or record side effects", () => {
  const before = openCalls;

  resolveLocalScope({ enabled: false, status: "disabled" });
  resolveLocalScope({ enabled: true, status: "loading" });
  resolveLocalScope({ enabled: true, status: "signed-out" });
  resolveLocalScope({ enabled: true, status: "signed-in", userId: USER_ID });
  resolveLocalScope({ enabled: true, status: "signed-in", userId: "bad" });

  assert.equal(openCalls, before);
});

// Focused tests for the pure scope resolver.
//
// The resolver must never touch storage, so indexedDB is replaced with a
// factory that fails if anything opens a database. That makes an accidental
// lookup or write a test failure rather than a silent real-data access.
//
// B2.1 rule set (ADR 0002 §4.2 rule 3): with authentication enabled, only a
// validated signed-in identity produces a scope. Loading is pending, a
// signed-out session is unavailable, and every failure is an explicit error.
// The anonymous database is reachable only from an explicitly auth-disabled
// development build.
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
const LETTERED_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const enabledStates: AuthStatus[] = [
  "disabled",
  "loading",
  "signed-out",
  "signed-in",
  "error",
];

function scopeOf(result: LocalScopeResolution): LocalScope {
  if (result.status !== "anonymous" && result.status !== "account") {
    assert.fail(`expected a resolved scope, received ${result.status}`);
  }
  return result.scope;
}

test("only an explicitly auth-disabled build resolves to anonymous scope", () => {
  const offline = resolveLocalScope({ enabled: false, status: "disabled" });

  assert.equal(offline.status, "anonymous");
  assert.equal(scopeOf(offline).kind, "anonymous");
  assert.equal(databaseNameForScope(scopeOf(offline)), "lifedesk");

  // With authentication enabled, no state may reach the anonymous database.
  for (const status of enabledStates) {
    for (const userId of [undefined, USER_ID, "not-a-uuid"]) {
      const result = resolveLocalScope({ enabled: true, status, userId });
      assert.notEqual(
        result.status,
        "anonymous",
        `enabled=${status} with id ${String(userId)} fell back to anonymous`,
      );
    }
  }
});

test("a signed-out session is unavailable and yields no scope", () => {
  const result = resolveLocalScope({ enabled: true, status: "signed-out" });

  assert.deepEqual(result, { status: "unavailable" });
  assert.equal("scope" in result, false);

  // A stale id left over from a previous session must not change the answer.
  const withStaleId = resolveLocalScope({
    enabled: true,
    status: "signed-out",
    userId: USER_ID,
  });

  assert.deepEqual(withStaleId, { status: "unavailable" });
  assert.equal("scope" in withStaleId, false);
});

test("a resolving session is pending and never opens a database", () => {
  const before = openCalls;
  const result = resolveLocalScope({ enabled: true, status: "loading" });

  assert.deepEqual(result, { status: "pending" });
  assert.equal("scope" in result, false);
  assert.equal(openCalls, before);
});

test("a failed session read is an error, never an anonymous fallback", () => {
  const before = openCalls;
  const result = resolveLocalScope({ enabled: true, status: "error" });

  assert.deepEqual(result, { status: "error", reason: "auth-error" });
  assert.equal("scope" in result, false);
  assert.equal(openCalls, before);
});

test("an inconsistent disabled status with auth enabled fails closed", () => {
  const result = resolveLocalScope({ enabled: true, status: "disabled" });

  assert.deepEqual(result, {
    status: "error",
    reason: "auth-disabled-conflict",
  });
  assert.equal("scope" in result, false);
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
  assert.equal(databaseNameForScope(scope), `lifedesk:user:${USER_ID}`);
});

test("UUID casing is normalised to one account scope and database", () => {
  const upper = resolveLocalScope({
    enabled: true,
    status: "signed-in",
    userId: LETTERED_ID.toUpperCase(),
  });
  const scope = scopeOf(upper);

  assert.equal(upper.status, "account");
  assert.equal(scope.kind, "user");
  if (scope.kind === "user") assert.equal(scope.userId, LETTERED_ID);
  assert.equal(databaseNameForScope(scope), `lifedesk:user:${LETTERED_ID}`);

  const lower = resolveLocalScope({
    enabled: true,
    status: "signed-in",
    userId: LETTERED_ID,
  });
  assert.equal(databaseNameForScope(scopeOf(lower)), databaseNameForScope(scope));
});

test("a signed-in session without a valid user id is an explicit error", () => {
  const invalidIds: (string | null | undefined)[] = [
    null,
    undefined,
    "",
    "not-a-uuid",
    "11111111-1111-4111-8111-11111111111",
    "11111111-1111-4111-8111-1111111111111",
    ` ${USER_ID}`,
    `${USER_ID} `,
    "11111111_1111_4111_8111_111111111111",
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
    assert.equal("scope" in result, false);
  }
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

  assert.deepEqual(signedOut, { status: "unavailable" });
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

  for (const enabled of [false, true]) {
    for (const status of enabledStates) {
      for (const userId of [undefined, USER_ID, "bad"]) {
        resolveLocalScope({ enabled, status, userId });
      }
    }
  }

  assert.equal(openCalls, before);
});

// Stage B1: the surface decision is the whole security boundary, so it is
// tested as a matrix rather than through individual flags.
import test from "node:test";

import { assert, makeThing } from "./helpers.ts";
import type { AppSurfaceInput } from "../lib/authGate.ts";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
define("indexedDB", indexedDB);
define("IDBKeyRange", IDBKeyRange);

const { resolveAppSurface, isAuthSurface } = await import(
  "../lib/authGate.ts"
);
const { anonymousStore } = await import("../lib/db.ts");

const signedOut: AppSurfaceInput = {
  ready: true,
  onboarded: true,
  authEnabled: true,
  authStatus: "signed-out",
  passwordResetReady: false,
};

test("a signed-out user is always sent to the auth gate", () => {
  assert.deepEqual(resolveAppSurface(signedOut), { kind: "auth-gate" });
});

test("onboarding, including the demo, cannot hide the gate", () => {
  // "Try the demo" completes onboarding while still signed out, so this is the
  // exact state it leaves behind.
  assert.deepEqual(resolveAppSurface({ ...signedOut, onboarded: false }), {
    kind: "auth-gate",
  });
});

test("no unauthenticated state can ever resolve to the app or onboarding", () => {
  for (const authStatus of [
    "loading",
    "error",
    "disabled",
    "signed-out",
  ] as const) {
    for (const ready of [false, true]) {
      for (const onboarded of [false, true]) {
        const surface = resolveAppSurface({
          ready,
          onboarded,
          authEnabled: true,
          authStatus,
          passwordResetReady: false,
        });
        assert.ok(
          surface.kind !== "app" && surface.kind !== "onboarding",
          `${authStatus} (ready=${ready}, onboarded=${onboarded}) reached ${surface.kind}`,
        );
      }
    }
  }
});

test("a loading session never reaches the dashboard", () => {
  for (const onboarded of [false, true]) {
    assert.deepEqual(
      resolveAppSurface({ ...signedOut, authStatus: "loading", onboarded }),
      { kind: "auth-loading" },
    );
  }
});

test("a failed session read is an error surface, not the dashboard", () => {
  assert.deepEqual(
    resolveAppSurface({ ...signedOut, authStatus: "error" }),
    { kind: "auth-error" },
  );
});

test("an inconsistent disabled status with auth enabled fails closed", () => {
  assert.deepEqual(
    resolveAppSurface({ ...signedOut, authStatus: "disabled" }),
    { kind: "auth-error" },
  );
});

test("an unrecognised auth status fails closed", () => {
  assert.deepEqual(
    resolveAppSurface({
      ...signedOut,
      authStatus: "unexpected" as AppSurfaceInput["authStatus"],
    }),
    { kind: "auth-error" },
  );
});

test("a signed-in user reaches the desk only once it is ready and onboarded", () => {
  const signedIn: AppSurfaceInput = { ...signedOut, authStatus: "signed-in" };

  assert.deepEqual(resolveAppSurface({ ...signedIn, ready: false }), {
    kind: "booting",
  });
  assert.deepEqual(resolveAppSurface({ ...signedIn, onboarded: false }), {
    kind: "onboarding",
  });
  assert.deepEqual(resolveAppSurface(signedIn), { kind: "app" });
});

test("a build without cloud auth keeps the offline flow", () => {
  const offline: AppSurfaceInput = {
    ...signedOut,
    authEnabled: false,
    authStatus: "disabled",
  };

  assert.deepEqual(resolveAppSurface({ ...offline, ready: false }), {
    kind: "booting",
  });
  assert.deepEqual(resolveAppSurface({ ...offline, onboarded: false }), {
    kind: "onboarding",
  });
  assert.deepEqual(resolveAppSurface(offline), { kind: "app" });
});

test("a recovery session keeps the reset form reachable", () => {
  // Supabase signs the user in before PASSWORD_RECOVERY, and the device may not
  // have finished onboarding, so both conditions must not win.
  const recovering: AppSurfaceInput = {
    ...signedOut,
    authStatus: "signed-in",
    passwordResetReady: true,
  };

  assert.deepEqual(resolveAppSurface(recovering), { kind: "recovery" });
  assert.deepEqual(resolveAppSurface({ ...recovering, onboarded: false }), {
    kind: "recovery",
  });
  assert.deepEqual(
    resolveAppSurface({ ...recovering, authStatus: "signed-out" }),
    { kind: "recovery" },
  );
});

test("the auth surfaces block hardware back", () => {
  for (const kind of [
    "auth-loading",
    "auth-error",
    "auth-gate",
    "recovery",
  ] as const) {
    assert.equal(isAuthSurface({ kind }), true, `${kind} should block back`);
  }
  for (const kind of ["booting", "onboarding", "app"] as const) {
    assert.equal(isAuthSurface({ kind }), false, `${kind} should not block back`);
  }
});

test("the retired dismissal latch cannot bypass the gate and is not deleted", () => {
  // Simulate a device that still carries the old latch from the previous build.
  const legacy = new Map<string, string>([
    ["livanta.authGate.dismissed.v1", "1"],
  ]);
  define("window", {
    localStorage: {
      getItem: (key: string) => legacy.get(key) ?? null,
      setItem: (key: string, value: string) => void legacy.set(key, value),
      removeItem: (key: string) => void legacy.delete(key),
    },
  });

  // Repeated resolution stands in for a reload or browser navigation: the
  // answer never changes, and nothing consults or clears the old key.
  assert.deepEqual(resolveAppSurface(signedOut), { kind: "auth-gate" });
  assert.deepEqual(resolveAppSurface(signedOut), { kind: "auth-gate" });
  assert.equal(legacy.get("livanta.authGate.dismissed.v1"), "1");
});

test("showing the gate leaves existing anonymous data untouched", async () => {
  const thing = makeThing({ id: "legacy-anonymous-thing" });
  await anonymousStore.putThing(thing);

  assert.deepEqual(resolveAppSurface(signedOut), { kind: "auth-gate" });

  const stored = await anonymousStore.getAllThings();
  assert.ok(stored.some((t) => t.id === thing.id), "anonymous record disappeared");

  await anonymousStore.deleteThing(thing.id);
});

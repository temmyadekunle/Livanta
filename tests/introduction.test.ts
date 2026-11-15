// Focused tests for the presentation-only introduction marker and gate.
//
// The introduction may read and write exactly one device-level localStorage
// key. These tests use an in-memory storage double so they never touch a real
// browser profile, and they cover the states where the introduction must not
// appear (loading, error, signed-in, signed-out with a marker, auth disabled).
import test from "node:test";

import { assert } from "./helpers.ts";
import {
  INTRODUCTION_MARKER_KEY,
  hasCompletedIntroduction,
  markIntroductionCompleted,
  shouldShowIntroduction,
} from "../lib/introduction.ts";
import type { AuthStatus } from "../lib/useAuth.ts";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const STATUSES: AuthStatus[] = [
  "disabled",
  "loading",
  "signed-out",
  "signed-in",
  "error",
];

test("the introduction is shown only to a signed-out, incomplete device", () => {
  for (const authEnabled of [false, true]) {
    for (const authStatus of STATUSES) {
      for (const completed of [false, true]) {
        const shown = shouldShowIntroduction({ authEnabled, authStatus, completed });
        const expected = authEnabled && authStatus === "signed-out" && !completed;
        assert.equal(
          shown,
          expected,
          `enabled=${authEnabled} status=${authStatus} completed=${completed}`,
        );
      }
    }
  }
});

test("auth loading and errors never fall through to the introduction", () => {
  for (const authStatus of ["loading", "error"] as AuthStatus[]) {
    assert.equal(
      shouldShowIntroduction({ authEnabled: true, authStatus, completed: false }),
      false,
    );
  }
});

test("a signed-in device is never shown the introduction", () => {
  assert.equal(
    shouldShowIntroduction({
      authEnabled: true,
      authStatus: "signed-in",
      completed: false,
    }),
    false,
  );
});

test("an auth-disabled development build keeps its existing surface", () => {
  for (const authStatus of STATUSES) {
    assert.equal(
      shouldShowIntroduction({ authEnabled: false, authStatus, completed: false }),
      false,
    );
  }
});

test("an absent or unrecognised marker counts as not completed", () => {
  assert.equal(hasCompletedIntroduction(memoryStorage()), false);
  assert.equal(hasCompletedIntroduction(memoryStorage({ [INTRODUCTION_MARKER_KEY]: "" })), false);
  assert.equal(
    hasCompletedIntroduction(memoryStorage({ [INTRODUCTION_MARKER_KEY]: "true" })),
    false,
  );
  assert.equal(
    hasCompletedIntroduction(memoryStorage({ [INTRODUCTION_MARKER_KEY]: "0" })),
    false,
  );
  assert.equal(hasCompletedIntroduction(null), false);
});

test("a completed marker is recognised", () => {
  const storage = memoryStorage({ [INTRODUCTION_MARKER_KEY]: "1" });
  assert.equal(hasCompletedIntroduction(storage), true);
});

test("the marker is written under the documented key with no personal data", () => {
  const storage = memoryStorage();
  markIntroductionCompleted(storage);

  assert.deepEqual([...storage.data.entries()], [[INTRODUCTION_MARKER_KEY, "1"]]);
});

test("unreadable storage is treated as not completed", () => {
  const throwing = {
    getItem() {
      throw new Error("storage disabled");
    },
  };
  assert.equal(hasCompletedIntroduction(throwing), false);
});

test("a refused marker write does not throw or write elsewhere", () => {
  const throwing = {
    setItem() {
      throw new Error("storage disabled");
    },
  };

  assert.doesNotThrow(() => markIntroductionCompleted(throwing));
  assert.doesNotThrow(() => markIntroductionCompleted(null));
});

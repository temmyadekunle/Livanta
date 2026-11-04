import test from "node:test";
import assert from "node:assert/strict";

import { performSignOut } from "../lib/signOut.ts";

test("a successful sign-out reports success", async () => {
  const result = await performSignOut({
    auth: { signOut: async () => ({ error: null }) },
  });
  assert.deepEqual(result, { ok: true });
});

test("a returned sign-out error is reported, not thrown", async () => {
  const result = await performSignOut({
    auth: {
      signOut: async () => ({ error: { message: "network down" } }),
    },
  });
  assert.deepEqual(result, { ok: false, message: "network down" });
});

test("a rejected sign-out becomes a failure result", async () => {
  const result = await performSignOut({
    auth: {
      signOut: async () => {
        throw new Error("offline");
      },
    },
  });
  assert.deepEqual(result, { ok: false, message: "offline" });
});

test("a non-Error rejection still becomes a failure result", async () => {
  const result = await performSignOut({
    auth: {
      signOut: async () => {
        throw "boom";
      },
    },
  });
  assert.equal(result.ok, false);
});

test("no configured client is a failure rather than a silent success", async () => {
  const result = await performSignOut(null);
  assert.equal(result.ok, false);
});

// The introduction is presentation-only and mandatory on every launch.
//
// It deliberately has no session, storage or completion input: the gate must
// not be skippable by a restored session, an old device marker or a previous
// build. Completion is launch-scoped state in lib/entryGate.ts, whose wiring is
// exercised end to end in tests/entryFlow.test.tsx.
import test from "node:test";

import { assert } from "./helpers.ts";
import { shouldShowIntroduction } from "../lib/introduction.ts";

test("every auth-enabled launch shows the introduction", () => {
  assert.equal(shouldShowIntroduction({ authEnabled: true }), true);
});

test("auth-disabled builds keep their offline onboarding", () => {
  assert.equal(shouldShowIntroduction({ authEnabled: false }), false);
});

test("the gate has no session or completion input to skip it with", () => {
  // @ts-expect-error a status cannot be supplied; the signature is the guard.
  shouldShowIntroduction({ authEnabled: true, authStatus: "signed-in" });
  // @ts-expect-error a stored marker cannot be supplied.
  shouldShowIntroduction({ authEnabled: true, completed: true });
});

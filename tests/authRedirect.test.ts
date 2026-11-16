/**
 * Where emailed links send the user.
 *
 * Omitting `emailRedirectTo`/`redirectTo` lets GoTrue fall back to the project
 * Site URL, which is a single dashboard value and therefore wrong for every
 * environment except the one it was last set to. The app must always name the
 * origin that is currently running the form.
 */

import test from "node:test";

import { assert } from "./helpers.ts";
import { authRedirectUrl } from "../lib/authRedirect.ts";

test("a link returns to the origin that submitted the form", () => {
  assert.equal(
    authRedirectUrl("https://livanta-tau.vercel.app", "/"),
    "https://livanta-tau.vercel.app/",
  );
  assert.equal(
    authRedirectUrl("http://localhost:3100", "/"),
    "http://localhost:3100/",
  );
});

test("the current path is preserved, not replaced by the Site URL", () => {
  assert.equal(
    authRedirectUrl("https://livanta-tau.vercel.app", "/profile/"),
    "https://livanta-tau.vercel.app/profile/",
  );
});

test("the origin and path are joined exactly once", () => {
  assert.equal(
    authRedirectUrl("https://livanta-tau.vercel.app", ""),
    "https://livanta-tau.vercel.app",
  );
});

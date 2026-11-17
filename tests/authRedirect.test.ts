/**
 * Where emailed links send the user.
 *
 * Omitting `emailRedirectTo`/`redirectTo` lets GoTrue fall back to the project
 * Site URL, which is a single dashboard value and therefore wrong for every
 * environment except the one it was last set to. These tests pin the policy:
 * localhost is a development-only destination, a deployed HTTPS origin returns
 * to itself, and a production build served over localhost or an insecure
 * address sends the link to the published app instead.
 */

import test from "node:test";

import { assert } from "./helpers.ts";
import {
  PUBLISHED_AUTH_ORIGIN,
  authRedirectUrl,
  setAuthRedirectEnvironmentForTesting,
} from "../lib/authRedirect.ts";

const LOCAL = "http://localhost:3100";
const LAN = "http://192.168.1.20:3100";
const STAGING = "https://staging.livanta.test";

test.beforeEach(() => {
  // Ambient NODE_ENV must not decide these cases.
  setAuthRedirectEnvironmentForTesting({ configuredOrigin: null, isProduction: false });
});

test.afterEach(() => setAuthRedirectEnvironmentForTesting(null));

test("local development returns to the running local server", () => {
  assert.equal(authRedirectUrl(LOCAL, "/"), "http://localhost:3100/");
});

test("a production build on localhost sends the link to the published app", () => {
  setAuthRedirectEnvironmentForTesting({ configuredOrigin: null, isProduction: true });
  assert.equal(authRedirectUrl(LOCAL, "/"), `${PUBLISHED_AUTH_ORIGIN}/`);
  assert.equal(
    authRedirectUrl(LOCAL, "/").includes("localhost"),
    false,
    "a recipient's phone cannot open a localhost link",
  );
});

test("a production build on an insecure LAN address also uses the published app", () => {
  setAuthRedirectEnvironmentForTesting({ configuredOrigin: null, isProduction: true });
  assert.equal(authRedirectUrl(LAN, "/"), `${PUBLISHED_AUTH_ORIGIN}/`);
});

test("a deployed HTTPS origin returns to itself", () => {
  setAuthRedirectEnvironmentForTesting({ configuredOrigin: null, isProduction: true });
  assert.equal(authRedirectUrl(STAGING, "/"), `${STAGING}/`);
  assert.equal(
    authRedirectUrl("https://livanta-tau.vercel.app", "/"),
    "https://livanta-tau.vercel.app/",
  );
});

test("a configured public origin wins, including on localhost", () => {
  setAuthRedirectEnvironmentForTesting({
    configuredOrigin: "https://beta.livanta.test",
    isProduction: true,
  });
  assert.equal(authRedirectUrl(LOCAL, "/profile/"), "https://beta.livanta.test/profile/");

  setAuthRedirectEnvironmentForTesting({
    configuredOrigin: "https://beta.livanta.test/",
    isProduction: false,
  });
  assert.equal(authRedirectUrl(LOCAL, "/"), "https://beta.livanta.test/");
});

test("an unusable configured origin is ignored rather than trusted", () => {
  for (const configuredOrigin of [
    "http://beta.livanta.test",
    "https://beta.livanta.test/app",
    "https://beta.livanta.test/?x=1",
    "https://localhost:3100",
    "not a url",
  ]) {
    setAuthRedirectEnvironmentForTesting({ configuredOrigin, isProduction: false });
    assert.equal(
      authRedirectUrl(LOCAL, "/"),
      "http://localhost:3100/",
      `${configuredOrigin} must not become the destination`,
    );
  }
});

test("the current path is preserved, not replaced by the Site URL", () => {
  setAuthRedirectEnvironmentForTesting({ configuredOrigin: null, isProduction: true });
  assert.equal(authRedirectUrl(STAGING, "/profile/"), `${STAGING}/profile/`);
  assert.equal(authRedirectUrl(STAGING, ""), STAGING);

  setAuthRedirectEnvironmentForTesting({ configuredOrigin: null, isProduction: false });
  assert.equal(authRedirectUrl(LOCAL, ""), LOCAL);
});

test("the published origin is a public HTTPS host", () => {
  const url = new URL(PUBLISHED_AUTH_ORIGIN);
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, "/");
  assert.equal(/localhost|127\.0\.0\.1/.test(url.hostname), false);
});

/**
 * The confirmation/recovery link parser.
 *
 * Supabase reports a failed link as URL-fragment parameters. The app must
 * recognise that before it decides the user is simply signed out, and it must
 * never read, store or log the token itself. These tests pin both halves: the
 * two outcomes the UI distinguishes, and the fragments the parser refuses to
 * touch.
 */

import test from "node:test";

import { assert } from "./helpers.ts";
import {
  parseAuthLinkError,
  parseConfirmationLinkAccessToken,
} from "../lib/authLinkError.ts";

test("an expired or already-used link is reported as expired", () => {
  assert.equal(
    parseAuthLinkError(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    ),
    "expired",
  );
  assert.equal(parseAuthLinkError("#error_code=otp_expired"), "expired");
});

test("any other failure is reported as invalid", () => {
  // No error_code: the description alone is not a stable contract, so the UI
  // falls back to the generic invalid-link copy.
  assert.equal(
    parseAuthLinkError("#error=access_denied&error_description=Email+link+is+invalid"),
    "invalid",
  );
  assert.equal(parseAuthLinkError("#error_code=access_denied"), "invalid");
  assert.equal(
    parseAuthLinkError("#error=server_error&error_code=unexpected_failure"),
    "invalid",
  );
});

test("an ordinary fragment is not an error", () => {
  assert.equal(parseAuthLinkError(""), null);
  assert.equal(parseAuthLinkError("#"), null);
  assert.equal(parseAuthLinkError("#type=signup"), null);
});

test("a fragment carrying tokens is left to the client, not parsed", () => {
  assert.equal(
    parseAuthLinkError(
      "#access_token=secret-token&refresh_token=secret-refresh&type=signup",
    ),
    null,
  );
  // An error alongside tokens is still a successful exchange as far as this
  // parser is concerned: clearing it would discard usable credentials.
  assert.equal(
    parseAuthLinkError("#access_token=secret-token&error=access_denied"),
    null,
  );
});

test("the parser keeps only its own classification", () => {
  const description = "a long server-supplied description";
  const result = parseAuthLinkError(
    `#error=access_denied&error_code=otp_expired&error_description=${encodeURIComponent(description)}`,
  );
  assert.equal(result, "expired");
  assert.equal(typeof result, "string");
  assert.notEqual(result, description);
});

/* The confirmation-token read. It exists solely so the auth store can compare
   the link's token with the session Supabase publishes; anything that is not a
   complete sign-up fragment must be left to the ordinary entry flow. */

const SIGNUP_FRAGMENT =
  "#access_token=token-1&refresh_token=refresh-1&expires_in=3600&expires_at=1800000000&token_type=bearer&type=signup";

test("a complete sign-up fragment yields its access token", () => {
  assert.equal(parseConfirmationLinkAccessToken(SIGNUP_FRAGMENT), "token-1");
  // The leading hash is optional, as it is for the error parser.
  assert.equal(
    parseConfirmationLinkAccessToken(SIGNUP_FRAGMENT.slice(1)),
    "token-1",
  );
});

test("only a sign-up fragment is a confirmation", () => {
  assert.equal(parseConfirmationLinkAccessToken(""), null);
  assert.equal(parseConfirmationLinkAccessToken("#"), null);
  assert.equal(parseConfirmationLinkAccessToken("#type=signup"), null);
  assert.equal(
    parseConfirmationLinkAccessToken(
      SIGNUP_FRAGMENT.replace("type=signup", "type=recovery"),
    ),
    null,
  );
  assert.equal(
    parseConfirmationLinkAccessToken(SIGNUP_FRAGMENT.replace("&type=signup", "")),
    null,
  );
});

test("a fragment missing a field the client needs is not a confirmation", () => {
  for (const field of ["access_token", "refresh_token", "expires_in", "token_type"]) {
    const without = SIGNUP_FRAGMENT.replace(
      new RegExp(`(^#|&)${field}=[^&]*`),
      "",
    );
    assert.equal(parseConfirmationLinkAccessToken(without), null, field);
  }
});

test("a failed link is never read as a confirmation", () => {
  // Unlike the error parser, this one refuses a fragment that also carries an
  // error: the tokens cannot be trusted to belong to a completed sign-up.
  assert.equal(
    parseConfirmationLinkAccessToken(`${SIGNUP_FRAGMENT}&error=access_denied`),
    null,
  );
  assert.equal(
    parseConfirmationLinkAccessToken(
      `${SIGNUP_FRAGMENT}&error_code=otp_expired`,
    ),
    null,
  );
});

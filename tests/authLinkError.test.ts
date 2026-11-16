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
import { parseAuthLinkError } from "../lib/authLinkError.ts";

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

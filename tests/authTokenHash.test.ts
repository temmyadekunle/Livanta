/**
 * The boundary around an emailed token hash.
 *
 * The hash is a single-use credential, so the parser is deliberately narrow:
 * one value, GoTrue's lowercase SHA-224 shape, and a type this app knows how to
 * verify. These tests also pin the URL-cleaning rules, because a token left in
 * the address bar is a token left in history.
 */

import test from "node:test";

import { assert } from "./helpers.ts";
import {
  AUTH_CONFIRM_PATH,
  hasImplicitOrErrorFragment,
  isTokenHashLink,
  parseTokenHashAppLink,
  parseTokenHashLink,
  stripSensitiveAuthParams,
} from "../lib/authTokenHash.ts";
import { PUBLISHED_AUTH_ORIGIN } from "../lib/authRedirect.ts";

const TOKEN = "a".repeat(56);
const OTHER = "b".repeat(56);

function url(path: string, suffix = ""): URL {
  return new URL(`${PUBLISHED_AUTH_ORIGIN}${path}${suffix}`);
}

test("accepts a lowercase SHA-224 token hash in a fragment", () => {
  const link = parseTokenHashLink(
    url(AUTH_CONFIRM_PATH, `#token_hash=${TOKEN}&type=signup`),
  );
  assert.deepEqual(link, { type: "signup", tokenHash: TOKEN });
});

test("accepts a recovery token hash in a query", () => {
  const link = parseTokenHashLink(
    url(AUTH_CONFIRM_PATH, `?token_hash=${TOKEN}&type=recovery`),
  );
  assert.deepEqual(link, { type: "recovery", tokenHash: TOKEN });
});

test("refuses an unknown or missing type before any network call", () => {
  for (const type of ["", "magiclink", "email", "email_change", "SIGNUP"]) {
    const suffix = type
      ? `#token_hash=${TOKEN}&type=${type}`
      : `#token_hash=${TOKEN}`;
    assert.equal(parseTokenHashLink(url(AUTH_CONFIRM_PATH, suffix)), null);
  }
});

test("refuses malformed hashes, including case and length changes", () => {
  for (const token of [
    "",
    "a".repeat(55),
    "a".repeat(57),
    "A".repeat(56),
    "g".repeat(56),
    "a".repeat(54) + "zz",
  ]) {
    assert.equal(
      parseTokenHashLink(
        url(AUTH_CONFIRM_PATH, `#token_hash=${token}&type=signup`),
      ),
      null,
      token,
    );
  }
});

test("refuses duplicated fields rather than choosing one", () => {
  assert.equal(
    parseTokenHashLink(
      url(AUTH_CONFIRM_PATH, `#token_hash=${TOKEN}&token_hash=${OTHER}&type=signup`),
    ),
    null,
  );
  assert.equal(
    parseTokenHashLink(
      url(AUTH_CONFIRM_PATH, `#token_hash=${TOKEN}&type=signup&type=recovery`),
    ),
    null,
  );
});

test("refuses a link that mixes a token hash with a session or failure", () => {
  const mixed = [
    `#token_hash=${TOKEN}&type=signup&access_token=x`,
    `#token_hash=${TOKEN}&type=signup&refresh_token=x`,
    `#token_hash=${TOKEN}&type=signup&error=denied`,
    `#token_hash=${TOKEN}&type=signup&error_code=otp_expired`,
  ];
  for (const suffix of mixed) {
    assert.equal(parseTokenHashLink(url(AUTH_CONFIRM_PATH, suffix)), null);
  }

  // The same conflict across the two halves of the URL is also refused.
  assert.equal(
    parseTokenHashLink(
      url(
        AUTH_CONFIRM_PATH,
        `?token_hash=${TOKEN}&type=signup#access_token=x`,
      ),
    ),
    null,
  );
});

test("refuses token values in both the query and the fragment", () => {
  assert.equal(
    parseTokenHashLink(
      url(
        AUTH_CONFIRM_PATH,
        `?token_hash=${TOKEN}&type=signup#token_hash=${OTHER}&type=signup`,
      ),
    ),
    null,
  );
});

test("cleaning removes every authentication field from both halves", () => {
  const dirty = url(
    AUTH_CONFIRM_PATH,
    `?token_hash=${TOKEN}&type=signup&keep=1&error_code=otp_expired#access_token=secret&refresh_token=refresh&type=recovery&tail=2`,
  );
  const clean = stripSensitiveAuthParams(dirty);

  assert.equal(clean.pathname, AUTH_CONFIRM_PATH);
  assert.equal(clean.searchParams.get("keep"), "1");
  assert.equal(clean.searchParams.has("token_hash"), false);
  assert.equal(clean.searchParams.has("type"), false);
  assert.equal(clean.searchParams.has("error_code"), false);
  assert.equal(clean.hash, "#tail=2");
  assert.equal(clean.toString().includes(TOKEN), false);
  assert.equal(clean.toString().includes("secret"), false);
  assert.equal(clean.toString().includes("refresh"), false);

  // The caller's URL object is untouched.
  assert.equal(dirty.searchParams.get("token_hash"), TOKEN);
});

test("cleaning drops an empty query and fragment entirely", () => {
  const clean = stripSensitiveAuthParams(
    url(AUTH_CONFIRM_PATH, `?token_hash=${TOKEN}&type=recovery#error=denied`),
  );
  assert.equal(clean.search, "");
  assert.equal(clean.hash, "");
  assert.equal(clean.toString(), `${PUBLISHED_AUTH_ORIGIN}${AUTH_CONFIRM_PATH}`);
});

test("implicit and failure fragments are recognised by field name only", () => {
  assert.equal(hasImplicitOrErrorFragment("#access_token=x"), true);
  assert.equal(hasImplicitOrErrorFragment("#refresh_token=x"), true);
  assert.equal(hasImplicitOrErrorFragment("#error_code=otp_expired"), true);
  assert.equal(hasImplicitOrErrorFragment("#error=denied"), true);
  assert.equal(hasImplicitOrErrorFragment(`#token_hash=${TOKEN}&type=signup`), false);
  assert.equal(hasImplicitOrErrorFragment(""), false);
});

test("an App Link is accepted only on the published HTTPS confirmation path", () => {
  const good = `${PUBLISHED_AUTH_ORIGIN}${AUTH_CONFIRM_PATH}#token_hash=${TOKEN}&type=signup`;
  assert.deepEqual(parseTokenHashAppLink(good, PUBLISHED_AUTH_ORIGIN), {
    type: "signup",
    tokenHash: TOKEN,
  });

  const refused = [
    good.replace("https:", "http:"),
    good.replace(PUBLISHED_AUTH_ORIGIN, "https://evil.example"),
    good.replace(PUBLISHED_AUTH_ORIGIN, "https://livanta.folababy02.workers.dev.evil"),
    good.replace(PUBLISHED_AUTH_ORIGIN, "https://localhost"),
    good.replace(AUTH_CONFIRM_PATH, "/"),
    good.replace(AUTH_CONFIRM_PATH, "/auth/confirm"),
    good.replace(AUTH_CONFIRM_PATH, "/auth/confirm/extra/"),
    good.replace(AUTH_CONFIRM_PATH, "/landing/"),
    `https://user:pass@livanta.folababy02.workers.dev${AUTH_CONFIRM_PATH}#token_hash=${TOKEN}&type=signup`,
    "com.temmyadekunle.livanta://auth/confirm/#token_hash=a&type=signup",
    "not a url",
    "",
    null,
    undefined,
  ];
  for (const candidate of refused) {
    assert.equal(
      parseTokenHashAppLink(candidate, PUBLISHED_AUTH_ORIGIN),
      null,
      String(candidate),
    );
  }
});

test("the runtime guard repeats the shape check", () => {
  assert.equal(isTokenHashLink({ type: "signup", tokenHash: TOKEN }), true);
  assert.equal(isTokenHashLink({ type: "magiclink", tokenHash: TOKEN }), false);
  assert.equal(isTokenHashLink({ type: "signup", tokenHash: "nope" }), false);
  assert.equal(isTokenHashLink(null), false);
  assert.equal(isTokenHashLink("signup"), false);
});

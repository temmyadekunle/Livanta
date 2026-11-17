/**
 * Which Android App Links the app is allowed to replay.
 *
 * The WebView runs on `https://localhost`, so the only safe way to honour an
 * email link is to take its fragment and reload the app's own root with it.
 * That makes this gate a security boundary: a link to another host, another
 * path, a custom scheme or a fragment the bootstrap cannot consume must be
 * ignored rather than navigated to. The failure-fragment cases matter because
 * the existing notice, not a silent reload, is what tells the user the link
 * expired.
 */

import test from "node:test";
import { readFileSync } from "node:fs";

import { assert } from "./helpers.ts";
import { parseConfirmationLinkAccessToken } from "../lib/authLinkError.ts";
import { PUBLISHED_AUTH_ORIGIN } from "../lib/authRedirect.ts";
import {
  nativeAuthLinkDestination,
  nativeAuthLinkFragment,
} from "../lib/nativeAuthLink.ts";

const MANIFEST = readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
const ASSET_LINKS = readFileSync(
  new URL("../public/.well-known/assetlinks.json", import.meta.url),
  "utf8",
);

const SIGNUP =
  "#access_token=signup-token&expires_in=3600&refresh_token=signup-refresh&token_type=bearer&type=signup";
const RECOVERY =
  "#access_token=recovery-token&expires_in=3600&refresh_token=recovery-refresh&token_type=bearer&type=recovery";
const EXPIRED =
  "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
const INVALID = "#error=access_denied&error_code=unexpected_failure";

function link(path: string, fragment = ""): string {
  return `${PUBLISHED_AUTH_ORIGIN}${path}${fragment}`;
}

test("accepts a sign-up confirmation on the published root", () => {
  const fragment = nativeAuthLinkFragment(link("/", SIGNUP));
  assert.equal(fragment, SIGNUP);
});

test("the accepted sign-up fragment is the one the bootstrap proves with", () => {
  const fragment = nativeAuthLinkFragment(link("/", SIGNUP));
  assert.notEqual(fragment, null);
  assert.equal(parseConfirmationLinkAccessToken(fragment ?? ""), "signup-token");
});

test("accepts a recovery session", () => {
  assert.equal(nativeAuthLinkFragment(link("/", RECOVERY)), RECOVERY);
});

test("accepts GoTrue failure fragments so the existing notice can explain them", () => {
  assert.equal(nativeAuthLinkFragment(link("/", EXPIRED)), EXPIRED);
  assert.equal(nativeAuthLinkFragment(link("/", INVALID)), INVALID);
});

test("refuses localhost, both insecure and secure", () => {
  assert.equal(nativeAuthLinkFragment(`http://localhost:3100/${SIGNUP}`), null);
  assert.equal(nativeAuthLinkFragment(`https://localhost/${SIGNUP}`), null);
  assert.equal(nativeAuthLinkFragment(`https://127.0.0.1/${SIGNUP}`), null);
});

test("refuses the right host over http, a foreign host, or a lookalike", () => {
  assert.equal(
    nativeAuthLinkFragment(`http://livanta.folababy02.workers.dev/${SIGNUP}`),
    null,
  );
  assert.equal(nativeAuthLinkFragment(`https://evil.example/${SIGNUP}`), null);
  assert.equal(
    nativeAuthLinkFragment(`https://livanta.folababy02.workers.dev.evil/${SIGNUP}`),
    null,
  );
});

test("refuses credentials in the URL", () => {
  assert.equal(
    nativeAuthLinkFragment(
      `https://user:pass@livanta.folababy02.workers.dev/${SIGNUP}`,
    ),
    null,
  );
});

test("refuses a path other than the app root", () => {
  assert.equal(nativeAuthLinkFragment(link("/landing/", SIGNUP)), null);
  assert.equal(nativeAuthLinkFragment(link("/privacy/", SIGNUP)), null);
});

test("refuses a query string", () => {
  assert.equal(nativeAuthLinkFragment(link("/?next=/", SIGNUP)), null);
});

test("refuses custom schemes and bare strings", () => {
  assert.equal(
    nativeAuthLinkFragment(`com.temmyadekunle.livanta://auth${SIGNUP}`),
    null,
  );
  assert.equal(nativeAuthLinkFragment("not a url"), null);
  assert.equal(nativeAuthLinkFragment(""), null);
  assert.equal(nativeAuthLinkFragment(null), null);
  assert.equal(nativeAuthLinkFragment(undefined), null);
});

test("refuses a link with no fragment or an empty one", () => {
  assert.equal(nativeAuthLinkFragment(link("/")), null);
  assert.equal(nativeAuthLinkFragment(link("/", "#")), null);
});

test("refuses fragments the bootstrap would not act on", () => {
  assert.equal(nativeAuthLinkFragment(link("/", "#foo=bar")), null);
  assert.equal(nativeAuthLinkFragment(link("/", "#access_token=only-one")), null);
  assert.equal(
    nativeAuthLinkFragment(
      link("/", "#access_token=a&refresh_token=b&type=magiclink"),
    ),
    null,
  );
  assert.equal(
    nativeAuthLinkFragment(
      link("/", "#access_token=a&refresh_token=b&type=recovery&error=denied"),
    ),
    null,
  );
  assert.equal(
    nativeAuthLinkFragment(
      link("/", "#error=denied&error_code=otp_expired&access_token=a&refresh_token=b&type=signup"),
    ),
    null,
  );
});

test("the destination is the app root with the fragment, never the raw link", () => {
  assert.equal(nativeAuthLinkDestination(SIGNUP), `/${SIGNUP}`);
  assert.equal(nativeAuthLinkDestination(RECOVERY), `/${RECOVERY}`);
  assert.equal(
    nativeAuthLinkDestination("#access_token=x"),
    "/#access_token=x",
  );
});

test("the manifest verifies exactly the published host, and never localhost", () => {
  const host = new URL(PUBLISHED_AUTH_ORIGIN).host;
  assert.ok(MANIFEST.includes('android:autoVerify="true"'));
  assert.ok(MANIFEST.includes('android:scheme="https"'));
  assert.ok(MANIFEST.includes(`android:host="${host}"`));
  assert.equal(MANIFEST.includes('android:host="localhost"'), false);
});

test("asset links name the app package and the release certificate", () => {
  const entries = JSON.parse(ASSET_LINKS) as {
    relation: string[];
    target: {
      namespace: string;
      package_name: string;
      sha256_cert_fingerprints: string[];
    };
  }[];
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].relation, [
    "delegate_permission/common.handle_all_urls",
  ]);
  assert.equal(entries[0].target.namespace, "android_app");
  assert.equal(entries[0].target.package_name, "com.temmyadekunle.livanta");
  for (const fingerprint of entries[0].target.sha256_cert_fingerprints) {
    assert.match(fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  }
});

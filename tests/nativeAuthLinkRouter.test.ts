/**
 * The one-shot and duplicate rules around a native App Link.
 *
 * Android repeats its launch intent and a WebView reload repeats it again.
 * These tests pin which event is allowed to act: a token hash is verified
 * once, a legacy fragment is replayed once, and a link on the confirmation
 * path with nothing usable is explained rather than silently ignored.
 */

import test from "node:test";

import { assert } from "./helpers.ts";
import { PUBLISHED_AUTH_ORIGIN } from "../lib/authRedirect.ts";
import {
  AUTH_CONFIRM_PATH,
  type TokenHashLink,
} from "../lib/authTokenHash.ts";
import { createNativeAuthLinkRouter } from "../lib/nativeAuthLinkRouter.ts";

const TOKEN = "a".repeat(56);
const OTHER = "b".repeat(56);
const SIGNUP = `#token_hash=${TOKEN}&type=signup`;
const RECOVERY = `#token_hash=${OTHER}&type=recovery`;
const IMPLICIT =
  "#access_token=signup-token&expires_in=3600&refresh_token=signup-refresh&token_type=bearer&type=signup";
const EXPIRED =
  "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

function link(path: string, suffix = ""): string {
  return `${PUBLISHED_AUTH_ORIGIN}${path}${suffix}`;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function harness(options: {
  storage?: StorageLike | null;
  verify?: (link: TokenHashLink) => Promise<unknown>;
} = {}) {
  const calls: {
    verified: TokenHashLink[];
    replayed: string[];
    invalid: number;
  } = { verified: [], replayed: [], invalid: 0 };

  const router = createNativeAuthLinkRouter({
    verify: async (token) => {
      calls.verified.push(token);
      return options.verify ? options.verify(token) : undefined;
    },
    reportInvalid: () => {
      calls.invalid += 1;
    },
    replay: (fragment) => {
      calls.replayed.push(fragment);
      return true;
    },
    storage: options.storage === undefined ? memoryStorage() : options.storage,
  });

  return { router, calls };
}

test("a warm token link is verified once and never stored", async () => {
  const { router, calls } = harness();
  assert.equal(await router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), false), "verified");
  assert.deepEqual(calls.verified, [{ type: "signup", tokenHash: TOKEN }]);
  assert.deepEqual(calls.replayed, []);
  assert.deepEqual(calls.invalid, 0);
});

test("a duplicate warm event does not spend the token twice", async () => {
  const { router, calls } = harness();
  await router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), false);
  assert.equal(await router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), false), "ignored");
  assert.equal(calls.verified.length, 1);
});

test("a later, different link is still handled", async () => {
  const { router, calls } = harness();
  await router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), false);
  await router.handle(link(AUTH_CONFIRM_PATH, RECOVERY), false);
  assert.deepEqual(
    calls.verified.map((entry) => entry.type),
    ["signup", "recovery"],
  );
});

test("a cold token launch is marked so a WebView reload does not repeat it", async () => {
  const storage = memoryStorage();
  const { router, calls } = harness({ storage });
  assert.equal(await router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), true), "verified");
  assert.equal(storage.values.get("livanta.nativeTokenLink.handled"), "1");
  assert.equal(calls.verified.length, 1);

  const next = harness({
    storage: memoryStorage({ "livanta.nativeTokenLink.handled": "1" }),
  });
  assert.equal(
    await next.router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), true),
    "ignored",
  );
  assert.equal(next.calls.verified.length, 0);
});

test("the initial appUrlOpen event is deduped against getLaunchUrl", async () => {
  const { router, calls } = harness();
  await router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), true);
  await router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), false);
  assert.equal(calls.verified.length, 1);
});

test("a link arriving while another is being verified is not exchanged", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { router, calls } = harness({
    verify: async () => {
      await gate;
    },
  });

  const first = router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), false);
  assert.equal(
    await router.handle(link(AUTH_CONFIRM_PATH, RECOVERY), false),
    "busy",
  );
  release();
  assert.equal(await first, "verified");
  assert.equal(calls.verified.length, 1);
});

test("a verifier rejection becomes a failed action, not an unhandled rejection", async () => {
  const { router, calls } = harness({
    verify: async () => {
      throw new Error("network");
    },
  });
  assert.equal(
    await router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), false),
    "failed",
  );
  assert.equal(calls.verified.length, 1);
});

test("a malformed token on the confirmation path is explained once", async () => {
  const { router, calls } = harness();
  const malformed = link(
    AUTH_CONFIRM_PATH,
    "#token_hash=not-a-hash&type=signup",
  );
  assert.equal(await router.handle(malformed, false), "invalid");
  assert.equal(await router.handle(malformed, false), "ignored");
  assert.equal(calls.invalid, 1);
  assert.equal(calls.verified.length, 0);
});

test("a confirmation path with no token at all is explained", async () => {
  const { router, calls } = harness();
  assert.equal(await router.handle(link(AUTH_CONFIRM_PATH), false), "invalid");
  assert.equal(await router.handle(link(AUTH_CONFIRM_PATH, "?foo=bar"), false), "invalid");
  assert.equal(calls.invalid, 2);
  assert.equal(calls.verified.length, 0);
});

test("foreign, lookalike and insecure links are ignored without an explanation", async () => {
  const { router, calls } = harness();
  for (const raw of [
    link("/", SIGNUP),
    link("/landing/", SIGNUP),
    link("/auth/confirm", SIGNUP),
    link("/auth/confirm/extra/", SIGNUP),
    `http://livanta.folababy02.workers.dev${AUTH_CONFIRM_PATH}${SIGNUP}`,
    `https://evil.example${AUTH_CONFIRM_PATH}${SIGNUP}`,
    `https://livanta.folababy02.workers.dev.evil${AUTH_CONFIRM_PATH}${SIGNUP}`,
    `https://localhost${AUTH_CONFIRM_PATH}${SIGNUP}`,
    `https://user:pass@livanta.folababy02.workers.dev${AUTH_CONFIRM_PATH}${SIGNUP}`,
    `com.temmyadekunle.livanta://auth/confirm/${SIGNUP}`,
    "not a url",
    null,
  ]) {
    assert.equal(await router.handle(raw, false), "ignored", String(raw));
  }
  assert.equal(calls.verified.length, 0);
  assert.equal(calls.invalid, 0);
});

test("legacy implicit links are still replayed at the root", async () => {
  const { router, calls } = harness();
  assert.equal(await router.handle(link("/", IMPLICIT), false), "replayed");
  assert.deepEqual(calls.replayed, [IMPLICIT]);
});

test("legacy links at the new confirmation path are replayed too", async () => {
  const { router, calls } = harness();
  assert.equal(
    await router.handle(link(AUTH_CONFIRM_PATH, IMPLICIT), false),
    "replayed",
  );
  assert.deepEqual(calls.replayed, [IMPLICIT]);
});

test("legacy failure fragments are replayed for the existing notice", async () => {
  const { router, calls } = harness();
  assert.equal(await router.handle(link("/", EXPIRED), false), "replayed");
  assert.deepEqual(calls.replayed, [EXPIRED]);
});

test("a legacy cold launch is replayed once across its own reload", async () => {
  const storage = memoryStorage();
  const first = harness({ storage });
  assert.equal(await first.router.handle(link("/", IMPLICIT), true), "replayed");
  assert.equal(storage.values.get("livanta.nativeAuthLink.replayed"), "1");

  const reloaded = harness({
    storage: memoryStorage({ "livanta.nativeAuthLink.replayed": "1" }),
  });
  assert.equal(reloaded.router.launchAvailable, false);
  assert.equal(
    await reloaded.router.handle(link("/", IMPLICIT), true),
    "ignored",
  );
  assert.equal(reloaded.calls.replayed.length, 0);
});

test("a duplicate legacy event is replayed only once", async () => {
  const { router, calls } = harness();
  await router.handle(link("/", IMPLICIT), false);
  await router.handle(link("/", IMPLICIT), false);
  assert.equal(calls.replayed.length, 1);
});

test("a storage failure still allows a token exchange but not a launch replay", async () => {
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };

  const token = harness({ storage: throwing });
  assert.equal(
    await token.router.handle(link(AUTH_CONFIRM_PATH, SIGNUP), true),
    "verified",
  );
  assert.equal(token.calls.verified.length, 1);

  const legacy = harness({ storage: throwing });
  assert.equal(await legacy.router.handle(link("/", IMPLICIT), true), "ignored");
  assert.equal(legacy.calls.replayed.length, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertProductionAuthConfig,
  hasUsableCloudConfig,
} from "../lib/supabase/config.ts";
import { isCloudEnabled } from "../lib/supabase/client.ts";

const VALID_URL = "https://abcdefgh.supabase.co";
const VALID_KEY = "eyJhbGciOiJIUzI1NiJ9.real";

test("a missing URL is rejected", () => {
  assert.equal(hasUsableCloudConfig(undefined, VALID_KEY), false);
});

test("a missing key is rejected", () => {
  assert.equal(hasUsableCloudConfig(VALID_URL, undefined), false);
});

test("no configuration at all is rejected", () => {
  assert.equal(hasUsableCloudConfig(undefined, undefined), false);
});

test("an empty URL is rejected", () => {
  assert.equal(hasUsableCloudConfig("", VALID_KEY), false);
});

test("an empty key is rejected", () => {
  assert.equal(hasUsableCloudConfig(VALID_URL, ""), false);
});

test("a whitespace-only URL is rejected", () => {
  for (const url of [" ", "   ", "\t", "\n\t "]) {
    assert.equal(hasUsableCloudConfig(url, VALID_KEY), false, JSON.stringify(url));
  }
});

test("a whitespace-only key is rejected", () => {
  for (const key of [" ", "   ", "\t", "\n\t "]) {
    assert.equal(hasUsableCloudConfig(VALID_URL, key), false, JSON.stringify(key));
  }
});

test("a malformed URL is rejected", () => {
  for (const url of ["not a url", "abcdefgh.supabase.co", "https://exa mple.com"]) {
    assert.equal(hasUsableCloudConfig(url, VALID_KEY), false, url);
  }
});

test("a hostless URL is rejected", () => {
  assert.equal(hasUsableCloudConfig("https://", VALID_KEY), false);
  assert.equal(hasUsableCloudConfig("  https://  ", VALID_KEY), false);
});

test("a plaintext URL is rejected", () => {
  assert.equal(hasUsableCloudConfig("http://abc.supabase.co", VALID_KEY), false);
});

test("the sample values from .env.example are rejected", () => {
  assert.equal(
    hasUsableCloudConfig("https://your-project.supabase.co", "your-anon-key"),
    false,
  );
  assert.equal(
    hasUsableCloudConfig("https://your-project-ref.supabase.co", "your-anon-key"),
    false,
  );
  assert.equal(
    hasUsableCloudConfig("https://their-project.supabase.co", "your-anon-key"),
    false,
  );
  assert.equal(
    hasUsableCloudConfig("https://your-project.supabase.co", VALID_KEY),
    false,
  );
  assert.equal(
    hasUsableCloudConfig("HTTPS://YOUR-PROJECT.supabase.co", "YOUR-ANON-KEY"),
    false,
  );
});

test("a real-looking https URL and key are accepted", () => {
  assert.equal(hasUsableCloudConfig(VALID_URL, VALID_KEY), true);
  assert.equal(
    hasUsableCloudConfig("https://self-hosted.example.com", "sb_publishable_real"),
    true,
  );
});

test("surrounding whitespace is trimmed before validation", () => {
  assert.equal(
    hasUsableCloudConfig(`  ${VALID_URL}  `, `  ${VALID_KEY}  `),
    true,
  );
});

test("an unconfigured build resolves cloud to off", () => {
  assert.equal(isCloudEnabled(), false);
});

test("production refuses to build without usable auth configuration", () => {
  for (const [url, key] of [
    [undefined, undefined],
    ["", ""],
    ["   ", "   "],
    [VALID_URL, "   "],
    ["   ", VALID_KEY],
    ["https://", VALID_KEY],
    ["not a url", VALID_KEY],
    ["http://abcdefgh.supabase.co", VALID_KEY],
    ["https://your-project.supabase.co", "your-anon-key"],
    [VALID_URL, undefined],
  ] as const) {
    assert.throws(
      () => assertProductionAuthConfig(url, key, "production"),
      /NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY/,
      `${url} / ${key}`,
    );
  }
});

test("production accepts a real-looking configuration", () => {
  assert.doesNotThrow(() =>
    assertProductionAuthConfig(VALID_URL, VALID_KEY, "production"),
  );
});

test("development and tests keep working without credentials", () => {
  for (const nodeEnv of ["development", "test", undefined]) {
    for (const [url, key] of [
      [undefined, undefined],
      ["   ", "   "],
      ["http://localhost:54321", "any-key"],
    ] as const) {
      assert.doesNotThrow(() =>
        assertProductionAuthConfig(url, key, nodeEnv),
      );
    }
  }
});

test("the failure message never contains the supplied credential values", () => {
  const url = "http://secret-project.supabase.co";
  const key = "sb_publishable_secret_value";

  try {
    assertProductionAuthConfig(url, key, "production");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(!message.includes(url), "message leaked the URL");
    assert.ok(!message.includes(key), "message leaked the key");
    return;
  }

  assert.fail("expected the production guard to throw");
});

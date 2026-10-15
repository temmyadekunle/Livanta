import { test } from "node:test";
import assert from "node:assert/strict";

import { hasUsableCloudConfig, isCloudEnabled } from "../lib/supabase/client.ts";

test("no configuration means cloud is off", () => {
  assert.equal(hasUsableCloudConfig(undefined, undefined), false);
  assert.equal(hasUsableCloudConfig("", ""), false);
  assert.equal(hasUsableCloudConfig("   ", "   "), false);
  assert.equal(hasUsableCloudConfig(undefined, "sb_publishable_x"), false);
  assert.equal(hasUsableCloudConfig("https://abc.supabase.co", undefined), false);
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
    hasUsableCloudConfig("https://your-project.supabase.co", "eyJhbGciOiJIUzI1NiJ9.real"),
    false,
  );
});

test("a plaintext URL is rejected", () => {
  assert.equal(
    hasUsableCloudConfig("http://abc.supabase.co", "eyJhbGciOiJIUzI1NiJ9.real"),
    false,
  );
});

test("a real-looking https URL and key are accepted", () => {
  assert.equal(
    hasUsableCloudConfig("https://abcdefgh.supabase.co", "eyJhbGciOiJIUzI1NiJ9.real"),
    true,
  );
  assert.equal(
    hasUsableCloudConfig("https://self-hosted.example.com", "sb_publishable_real"),
    true,
  );
});

test("an unconfigured build resolves cloud to off", () => {
  assert.equal(isCloudEnabled(), false);
});

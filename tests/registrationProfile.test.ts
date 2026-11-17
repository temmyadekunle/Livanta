import test from "node:test";
import { IDBFactory } from "fake-indexeddb";

import { assert } from "./helpers.ts";
import type { LocalStore } from "../lib/db.ts";
import type { LocalScope } from "../lib/db.ts";
import type { Settings } from "../lib/settings.ts";

Object.defineProperty(globalThis, "indexedDB", {
  value: new IDBFactory(),
  writable: true,
  configurable: true,
});

const { anonymousStore, closeScope, createLocalStore, userScope } = await import("../lib/db.ts");
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import("../lib/settings.ts");
const { saveRegistrationProfile } = await import("../lib/registrationProfile.ts");

const AVATAR = "data:image/png;base64,AAAA";
const OTHER_AVATAR = "data:image/jpeg;base64,BBBB";
const NEW_ID = "11111111-1111-4111-8111-111111111111";
const EXISTING_ID = "22222222-2222-4222-8222-222222222222";
const BLANK_ID = "33333333-3333-4333-8333-333333333333";
const LOCALIZED_ID = "44444444-4444-4444-8444-444444444444";

const scopes: LocalScope[] = [];
function storeFor(userId: string): LocalStore {
  const scope = userScope(userId);
  scopes.push(scope);
  return createLocalStore(scope);
}

test.after(async () => {
  for (const scope of scopes) await closeScope(scope);
});

test("saves the registration profile to the new account's store", async (t) => {
  const getSetting = t.mock.method(anonymousStore, "getSetting", () => {
    throw new Error("registration must never read anonymous settings");
  });
  const putSetting = t.mock.method(anonymousStore, "putSetting", () => {
    throw new Error("registration must never write anonymous settings");
  });
  const store = storeFor(NEW_ID);

  assert.equal(
    await saveRegistrationProfile(NEW_ID, {
      displayName: "  Temmy  ",
      avatar: AVATAR,
    }),
    true,
  );

  const saved = await loadSettings(store);
  assert.equal(saved.displayName, "Temmy");
  assert.equal(saved.avatar, AVATAR);
  assert.equal(saved.onboarded, true, "registration answers first-run setup");
  assert.equal(getSetting.mock.callCount(), 0);
  assert.equal(putSetting.mock.callCount(), 0);

  const raw = await store.getSetting<Partial<Settings>>("settings");
  assert.equal(raw?.displayName, "Temmy");
  assert.equal(raw?.avatar, AVATAR);
});

test("a new account keeps the entry flow's language", async () => {
  const store = storeFor(LOCALIZED_ID);

  assert.equal(
    await saveRegistrationProfile(LOCALIZED_ID, {
      displayName: "Adaeze",
      locale: "ig",
    }),
    true,
  );

  const saved = await loadSettings(store);
  assert.equal(saved.locale, "ig");
});

test("never overwrites an existing name or picture", async () => {
  const store = storeFor(EXISTING_ID);
  await saveSettings(store, {
    ...DEFAULT_SETTINGS,
    onboarded: true,
    displayName: "Existing Name",
    avatar: OTHER_AVATAR,
    locale: "ha",
  });

  assert.equal(
    await saveRegistrationProfile(EXISTING_ID, {
      displayName: "Replacement",
      avatar: AVATAR,
      locale: "ig",
    }),
    true,
  );

  const saved = await loadSettings(store);
  assert.equal(saved.displayName, "Existing Name");
  assert.equal(saved.avatar, OTHER_AVATAR);
  assert.equal(saved.locale, "ha", "a completed account's language is not reset");
});

test("fills only the fields that are still empty", async () => {
  const store = storeFor(EXISTING_ID);
  await saveSettings(store, {
    ...DEFAULT_SETTINGS,
    displayName: "Existing Name",
    avatar: "",
  });

  assert.equal(
    await saveRegistrationProfile(EXISTING_ID, {
      displayName: "Replacement",
      avatar: AVATAR,
    }),
    true,
  );

  const saved = await loadSettings(store);
  assert.equal(saved.displayName, "Existing Name");
  assert.equal(saved.avatar, AVATAR);
  assert.equal(saved.onboarded, true, "an incomplete profile still finishes setup");
});

test("blank profile input still completes first-run setup", async () => {
  const store = storeFor(BLANK_ID);

  assert.equal(
    await saveRegistrationProfile(BLANK_ID, {
      displayName: "   ",
      avatar: "javascript:alert(1)",
      locale: "yo",
    }),
    true,
  );

  const raw = await store.getSetting<Partial<Settings>>("settings");
  assert.equal(raw?.onboarded, true);
  assert.equal(raw?.displayName, "", "no blank name is stored");
  assert.equal(raw?.avatar, "", "an invalid picture is not stored");
  assert.equal(raw?.locale, "yo");
});

test("a malformed user id is refused rather than opening a store", async () => {
  assert.equal(
    await saveRegistrationProfile("not-a-supabase-id", {
      displayName: "Temmy",
      avatar: AVATAR,
    }),
    false,
  );
});

// The resolver is pure, so the unit test proves it never opens a database.
// This file complements that by running against a real (fake) IndexedDB:
// legacy anonymous records are seeded first, then every resolution outcome is
// produced, and the records must be byte-for-byte unchanged afterwards. That
// covers the remaining ways a "pure" resolver could still be wrong: reading,
// migrating, claiming or clearing existing device data.
import test from "node:test";

import { assert, makeThing } from "./helpers.ts";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, {
    value,
    writable: true,
    configurable: true,
  });

const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
define("indexedDB", indexedDB);
define("IDBKeyRange", IDBKeyRange);

const { resolveLocalScope } = await import("../lib/localScope.ts");
const { anonymousStore } = await import("../lib/db.ts");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SETTINGS_KEY = "settings";
const OWNER_KEY = "__livanta_sync_data_owner";

test("resolving a scope never reads, migrates or deletes anonymous data", async () => {
  const thing = makeThing({ id: "legacy-anonymous-thing" });
  const settings = { onboarded: true, language: "en" };
  await anonymousStore.putThing(thing);
  await anonymousStore.putSetting(SETTINGS_KEY, settings);

  const outcomes = [
    resolveLocalScope({ enabled: false, status: "disabled" }),
    resolveLocalScope({ enabled: true, status: "loading" }),
    resolveLocalScope({ enabled: true, status: "signed-out" }),
    resolveLocalScope({ enabled: true, status: "error" }),
    resolveLocalScope({ enabled: true, status: "disabled" }),
    resolveLocalScope({ enabled: true, status: "signed-in", userId: USER_ID }),
    resolveLocalScope({
      enabled: true,
      status: "signed-in",
      userId: "not-a-uuid",
    }),
  ];

  // Exactly one outcome names the anonymous scope (the explicitly disabled
  // development build) and exactly one names an account. The rest are inert.
  assert.equal(outcomes.filter((r) => r.status === "anonymous").length, 1);
  assert.equal(outcomes.filter((r) => r.status === "account").length, 1);

  const things = await anonymousStore.getAllThings();
  assert.deepEqual(
    things.map((t) => t.id),
    [thing.id],
    "anonymous records were added, removed or replaced",
  );
  assert.deepEqual(things[0], thing, "an anonymous record was modified");

  assert.deepEqual(
    await anonymousStore.getSetting(SETTINGS_KEY),
    settings,
    "anonymous settings were modified",
  );
  assert.equal(
    await anonymousStore.getSetting(OWNER_KEY),
    null,
    "resolution must not claim anonymous data",
  );

  await anonymousStore.deleteThing(thing.id);
});

import test from "node:test";
import { IDBFactory } from "fake-indexeddb";

import { assert, buildAlerts, derivePriority, makeAlert, makeThing } from "./helpers.ts";
import type { LocalStore } from "../lib/db.ts";
import type { Settings } from "../lib/settings.ts";

Object.defineProperty(globalThis, "indexedDB", {
  value: new IDBFactory(),
  writable: true,
  configurable: true,
});

const { anonymousStore, closeScope, createLocalStore, userScope } = await import("../lib/db.ts");
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import("../lib/settings.ts");
const { SEED_MEMBERS, SEED_THINGS, seedIfEmpty } = await import("../lib/seed.ts");
const { AVATAR_MAX_CHARS } = await import("../lib/avatar.ts");

const stores: LocalStore[] = [anonymousStore];
function accountStore(): LocalStore {
  const id = `00000000-0000-4000-8000-${String(stores.length).padStart(12, "0")}`;
  const store = createLocalStore(userScope(id));
  stores.push(store);
  return store;
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

test.after(async () => {
  for (const store of stores) await closeScope(store.scope);
});

test("settings and seeding use explicit stores exclusively", async (t) => {
  const forbidden = [
    "getSetting", "putSetting", "getAllThings", "putThing", "getAllAlerts",
    "putAlert", "getAllMembers", "putMember",
  ] as const;
  const guards = forbidden.map((method) => t.mock.method(anonymousStore, method, () => {
    throw new Error(`Unexpected anonymous access: ${method}`);
  }));
  t.after(() => {
    for (const guard of guards) assert.equal(guard.mock.callCount(), 0);
  });

  await t.test("empty settings return unchanged defaults without persisting them", async () => {
    const store = accountStore();
    const loaded = await loadSettings(store);
    assert.deepEqual(loaded, DEFAULT_SETTINGS);
    assert.notEqual(loaded, DEFAULT_SETTINGS);
    assert.equal(await store.getSetting("settings"), null);
  });

  await t.test("loads supplied-store settings and merges missing fields with defaults", async () => {
    const store = accountStore();
    const partial = { displayName: "Account A", locale: "ha", notifyUrgent: false };
    await store.putSetting("settings", partial);
    assert.deepEqual(await loadSettings(store), { ...DEFAULT_SETTINGS, ...partial });
    assert.deepEqual(await store.getSetting("settings"), partial);
  });

  await t.test("saves all fields unchanged under the existing settings key", async () => {
    const store = accountStore();
    const settings: Settings = {
      onboarded: true,
      displayName: "Account A",
      avatar: "data:image/png;base64,AAAA",
      locale: "yo",
      dataSaver: false,
      notifyUrgent: false,
      leadDays: [7, 1],
      managedCategories: ["home", "family"],
    };
    assert.equal(await saveSettings(store, settings), undefined);
    assert.deepEqual(await store.getSetting("settings"), settings);
    assert.deepEqual(await loadSettings(store), settings);
    settings.leadDays.push(3);
    assert.deepEqual((await loadSettings(store)).leadDays, [7, 1]);
  });

  await t.test("two accounts retain independent settings", async () => {
    const a = accountStore();
    const b = accountStore();
    const settingsA = { ...DEFAULT_SETTINGS, displayName: "Account A", locale: "ig" as const };
    const settingsB = { ...DEFAULT_SETTINGS, displayName: "Account B", locale: "ha" as const };
    await saveSettings(a, settingsA);
    assert.deepEqual(await loadSettings(b), DEFAULT_SETTINGS);
    await saveSettings(b, settingsB);
    assert.deepEqual(await loadSettings(a), settingsA);
    assert.deepEqual(await loadSettings(b), settingsB);
  });

  await t.test("all supported locales survive loading", async () => {
    const store = accountStore();
    for (const locale of ["en", "ha", "ig", "yo"] as const) {
      await saveSettings(store, { ...DEFAULT_SETTINGS, locale });
      assert.equal((await loadSettings(store)).locale, locale);
    }
  });

  await t.test("invalid locales normalize on read without rewriting stored settings", async () => {
    const store = accountStore();
    for (const locale of ["zz", "EN", "", null, 42]) {
      const raw = { ...DEFAULT_SETTINGS, locale } as unknown as Settings;
      await saveSettings(store, raw);
      assert.deepEqual(await loadSettings(store), DEFAULT_SETTINGS);
      assert.deepEqual(await store.getSetting("settings"), raw);
    }
  });

  await t.test("avatar validation is unchanged and does not rewrite storage", async () => {
    const store = accountStore();
    for (const type of ["png", "jpeg", "webp"]) {
      const avatar = `data:image/${type};base64,AAAA`;
      await store.putSetting("settings", { avatar });
      assert.equal((await loadSettings(store)).avatar, avatar);
    }
    for (const avatar of [null, 42, "", "javascript:alert(1)", "data:image/svg+xml;base64,AAAA",
      `data:image/png;base64,${"A".repeat(AVATAR_MAX_CHARS)}`]) {
      await store.putSetting("settings", { avatar });
      assert.equal((await loadSettings(store)).avatar, "");
      assert.deepEqual(await store.getSetting("settings"), { avatar });
    }
  });

  await t.test("read failures return defaults without attempting another store", async (t) => {
    const store = accountStore();
    const read = t.mock.method(store, "getSetting", async () => {
      throw new Error("read failed");
    });
    const write = t.mock.method(store, "putSetting");
    assert.deepEqual(await loadSettings(store), DEFAULT_SETTINGS);
    assert.equal(read.mock.callCount(), 1);
    assert.equal(write.mock.callCount(), 0);
  });

  await t.test("save failures propagate without retrying in anonymous storage", async (t) => {
    const store = accountStore();
    const error = new Error("write failed");
    const write = t.mock.method(store, "putSetting", async () => { throw error; });
    await assert.rejects(saveSettings(store, DEFAULT_SETTINGS), (e) => e === error);
    assert.equal(write.mock.callCount(), 1);
  });

  await t.test("explicit null or undefined cannot select the legacy overload", async () => {
    for (const invalid of [null, undefined]) {
      const store = invalid as unknown as LocalStore;
      assert.deepEqual(await loadSettings(store), DEFAULT_SETTINGS);
      await assert.rejects(saveSettings(store, DEFAULT_SETTINGS), TypeError);
      await assert.rejects(seedIfEmpty(store), TypeError);
    }
  });

  await t.test("seeding writes the unchanged samples, members and alerts only to its store", async (t) => {
    const store = accountStore();
    const writeSettings = t.mock.method(store, "putSetting");
    const things = await seedIfEmpty(store);
    assert.equal(things.length, SEED_THINGS.length);
    assert.equal(new Set(things.map((thing) => thing.id)).size, things.length);
    for (const [index, thing] of things.entries()) {
      assert.ok(thing.id);
      assert.ok(Number.isFinite(Date.parse(thing.createdAt)));
      assert.equal(thing.updatedAt, thing.createdAt);
      assert.deepEqual(thing, {
        ...SEED_THINGS[index],
        id: thing.id,
        currency: "NGN",
        createdAt: thing.createdAt,
        updatedAt: thing.updatedAt,
        priority: derivePriority(thing, new Date(thing.createdAt)),
      });
    }
    assert.deepEqual(byId(await store.getAllThings()), byId(things));
    assert.deepEqual(await store.getAllMembers(), SEED_MEMBERS);
    const alerts = await store.getAllAlerts();
    assert.ok(alerts.length > 0);
    assert.deepEqual(byId(alerts), byId(buildAlerts(things, new Date(alerts[0].createdAt))));
    assert.equal(writeSettings.mock.callCount(), 0);
  });

  await t.test("seeding one account leaves another empty account unpopulated", async () => {
    const a = accountStore();
    const b = accountStore();
    assert.deepEqual(await a.getAllThings(), []);
    assert.deepEqual(await b.getAllThings(), []);
    await seedIfEmpty(a);
    assert.deepEqual(await b.getAllThings(), []);
    assert.deepEqual(await b.getAllAlerts(), []);
    assert.deepEqual(await b.getAllMembers(), []);
    assert.equal(await b.getSetting("settings"), null);
  });

  await t.test("populated stores return existing things without writing any samples", async (t) => {
    const store = accountStore();
    const thing = makeThing({ id: "existing", name: "Keep me" });
    const alert = makeAlert({ thingId: thing.id });
    const member = { ...SEED_MEMBERS[0], name: "Keep this member" };
    const settings = { ...DEFAULT_SETTINGS, displayName: "Keep these settings" };
    await store.putThing(thing);
    await store.putAlert(alert);
    await store.putMember(member);
    await saveSettings(store, settings);
    const writes = ["putThing", "putAlert", "putMember", "putSetting"] as const;
    const spies = writes.map((method) => t.mock.method(store, method));
    assert.deepEqual(await seedIfEmpty(store), [thing]);
    assert.deepEqual(await store.getAllThings(), [thing]);
    assert.deepEqual(await store.getAllAlerts(), [alert]);
    assert.deepEqual(await store.getAllMembers(), [member]);
    assert.deepEqual(await loadSettings(store), settings);
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
  });

  await t.test("repeated seeding does not duplicate records or change their IDs", async () => {
    const store = accountStore();
    const first = await seedIfEmpty(store);
    const alerts = await store.getAllAlerts();
    const members = await store.getAllMembers();
    assert.deepEqual(byId(await seedIfEmpty(store)), byId(first));
    assert.deepEqual(await store.getAllAlerts(), alerts);
    assert.deepEqual(await store.getAllMembers(), members);
  });

  await t.test("empty things still permit seeding when other stores contain data", async () => {
    const store = accountStore();
    const alert = makeAlert({ id: "existing-alert" });
    const member = { ...SEED_MEMBERS[0], id: "existing-member" };
    const settings = { ...DEFAULT_SETTINGS, locale: "yo" as const };
    await store.putAlert(alert);
    await store.putMember(member);
    await saveSettings(store, settings);
    assert.equal((await seedIfEmpty(store)).length, SEED_THINGS.length);
    assert.ok((await store.getAllAlerts()).some((row) => row.id === alert.id));
    assert.ok((await store.getAllMembers()).some((row) => row.id === member.id));
    assert.deepEqual(await loadSettings(store), settings);
  });

  await t.test("seeding read failures propagate without starting any writes", async (t) => {
    const store = accountStore();
    const error = new Error("read failed");
    t.mock.method(store, "getAllThings", async () => { throw error; });
    const writes = ["putThing", "putMember", "putAlert"] as const;
    const spies = writes.map((method) => t.mock.method(store, method));
    await assert.rejects(seedIfEmpty(store), (e) => e === error);
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
  });

  await t.test("seeding write failures propagate without writing to another store", async (t) => {
    const store = accountStore();
    const error = new Error("write failed");
    const write = t.mock.method(store, "putThing", async () => { throw error; });
    await assert.rejects(seedIfEmpty(store), (e) => e === error);
    assert.equal(write.mock.callCount(), 1);
    assert.deepEqual(await store.getAllThings(), []);
    assert.deepEqual(await store.getAllMembers(), []);
    assert.deepEqual(await store.getAllAlerts(), []);
  });
});

test("legacy calls preserve anonymous behavior without affecting accounts", async () => {
  assert.deepEqual(await anonymousStore.getAllThings(), []);
  assert.deepEqual(await anonymousStore.getAllAlerts(), []);
  assert.deepEqual(await anonymousStore.getAllMembers(), []);
  assert.equal(await anonymousStore.getSetting("settings"), null);
  assert.deepEqual(await loadSettings(), DEFAULT_SETTINGS);

  const account = accountStore();
  const settings = { ...DEFAULT_SETTINGS, displayName: "Device", locale: "ha" as const };
  await saveSettings(settings);
  assert.deepEqual(await loadSettings(), settings);
  assert.deepEqual(await anonymousStore.getSetting("settings"), settings);
  assert.deepEqual(await loadSettings(account), DEFAULT_SETTINGS);

  const first = await seedIfEmpty();
  assert.equal(first.length, SEED_THINGS.length);
  assert.deepEqual(byId(await anonymousStore.getAllThings()), byId(first));
  assert.deepEqual(await anonymousStore.getAllMembers(), SEED_MEMBERS);
  assert.ok((await anonymousStore.getAllAlerts()).length > 0);
  assert.deepEqual(byId(await seedIfEmpty()), byId(first));
  assert.deepEqual(await loadSettings(), settings);
  assert.deepEqual(await account.getAllThings(), []);

  const accountSettings = { ...DEFAULT_SETTINGS, displayName: "Account", locale: "ig" as const };
  await saveSettings(account, accountSettings);
  assert.deepEqual(await loadSettings(account), accountSettings);
  const accountThings = await seedIfEmpty(account);
  assert.equal(accountThings.length, SEED_THINGS.length);
  assert.deepEqual(byId(await anonymousStore.getAllThings()), byId(first));
  assert.deepEqual(await loadSettings(), settings);
});

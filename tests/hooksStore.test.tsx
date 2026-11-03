// Explicit-store and stale-operation coverage for useLivanta.
//
// These tests use a real hook against happy-dom and in-memory IndexedDB. They
// are deliberately separate from hooks.test.tsx so the legacy no-argument
// behaviour stays covered alongside the new account-store path.
import { register } from "node:module";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { assert, makeThing } from "./helpers.ts";
import type { LocalStore } from "../lib/db.ts";
import type { ImportPlan } from "../lib/import.ts";
import type { Settings } from "../lib/settings.ts";
import type { SyncMeta } from "../lib/sync/meta.ts";
import type { Thing } from "../lib/types.ts";

register("./tsx-loader.mjs", import.meta.url);

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { Window } = await import("happy-dom");
const fake = await import("fake-indexeddb");

const win = new Window({ url: "https://livanta.test/" });
define("window", win);
define("document", win.document);
define("navigator", win.navigator);
define("location", win.location);
define("indexedDB", fake.indexedDB);
define("IDBKeyRange", fake.IDBKeyRange);
define("IS_REACT_ACT_ENVIRONMENT", true);

const { anonymousStore, closeScope, createLocalStore, userScope } = await import("../lib/db.ts");
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import("../lib/settings.ts");
const { SEED_THINGS } = await import("../lib/seed.ts");
const { SYNC_META_KEY, syncMetaKey, syncOwner } = await import("../lib/sync/meta.ts");
const { useLivanta } = await import("../lib/useLivanta.ts");

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const accountA = createLocalStore(userScope(A_ID));
const accountB = createLocalStore(userScope(B_ID));
const ownerA = syncOwner(A_ID);

type Desk = ReturnType<typeof useLivanta>;

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function rentInput(name = "Rent") {
  return {
    name,
    category: "home" as const,
    kind: "rent" as const,
    amount: 50_000,
    dueDate: yesterday(),
    recurrence: { frequency: "monthly" as const, interval: 1 },
    notes: "",
  };
}

test.beforeEach(async () => {
  await anonymousStore.clear();
  await accountA.clear();
  await accountB.clear();
});

test.after(async () => {
  for (const store of [accountA, accountB, anonymousStore]) {
    await closeScope(store.scope);
  }
});

async function flush(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  let result!: T;
  await act(async () => {
    result = await operation();
  });
  return result;
}

function mountStore(initialStore: LocalStore) {
  let latest: Desk | undefined;
  const container = win.document.createElement("div");
  const root = createRoot(container as unknown as Element);

  function Probe({ store }: { store: LocalStore }) {
    latest = useLivanta(store);
    return null;
  }

  const renderStore = (store: LocalStore) => {
    act(() => root.render(<Probe store={store} />));
  };
  renderStore(initialStore);

  return {
    get desk() {
      if (!latest) throw new Error("hook never rendered");
      return latest;
    },
    switchTo(store: LocalStore) {
      renderStore(store);
    },
    async settle() {
      for (let i = 0; i < 60; i += 1) {
        await flush(1);
        if (latest?.ready) return;
      }
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

function mountLegacyHook() {
  let latest: Desk | undefined;
  const container = win.document.createElement("div");
  const root = createRoot(container as unknown as Element);

  function Probe() {
    latest = useLivanta();
    return null;
  }

  act(() => root.render(<Probe />));

  return {
    get desk() {
      if (!latest) throw new Error("hook never rendered");
      return latest;
    },
    async settle() {
      for (let i = 0; i < 60; i += 1) {
        await flush(1);
        if (latest?.ready) return;
      }
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

test("boots from the explicit store and ignores the anonymous database", async (t) => {
  await saveSettings(accountA, { ...DEFAULT_SETTINGS, displayName: "Account A", locale: "yo" });
  await accountA.putThing(makeThing({ id: "a-loaded", name: "Loaded A" }));
  await anonymousStore.putThing(makeThing({ id: "anonymous-only", name: "Anonymous" }));

  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  assert.equal(h.desk.ready, true);
  assert.equal(h.desk.loading, false);
  assert.equal(h.desk.error, null);
  assert.equal(h.desk.settings.displayName, "Account A");
  assert.equal(h.desk.settings.locale, "yo");
  assert.deepEqual(h.desk.things.map((thing) => thing.id), ["a-loaded"]);
  assert.deepEqual(await accountB.getAllThings(), []);
});

test("things CRUD writes only the selected account store", async (t) => {
  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  await run(() => h.desk.addThing(rentInput()));
  assert.equal((await accountA.getAllThings()).length, 1);
  assert.deepEqual(await accountB.getAllThings(), []);
  assert.deepEqual(await anonymousStore.getAllThings(), []);

  await run(() => h.desk.updateThing(h.desk.things[0], { name: "Updated rent" }));
  assert.equal((await accountA.getAllThings())[0].name, "Updated rent");

  await run(() => h.desk.completeThing(h.desk.things[0]));
  const completed = (await accountA.getAllThings())[0];
  assert.equal(completed.status, "active");
  assert.ok(completed.lastHandledDate);

  await run(() => h.desk.removeThing(h.desk.things[0].id));
  assert.deepEqual(await accountA.getAllThings(), []);
  assert.deepEqual(await accountB.getAllThings(), []);
});

test("alerts, dismissal restoration and settings use only the selected store", async (t) => {
  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  await run(() => h.desk.addThing(rentInput()));
  assert.ok(h.desk.alerts.length > 0);
  const alert = h.desk.alerts[0];

  await run(() => h.desk.dismissAlert(alert));
  const dismissed = await accountA.getAllAlerts();
  assert.equal(dismissed.length, 1);
  assert.equal(dismissed[0].dismissed, true);
  assert.deepEqual(await accountB.getAllAlerts(), []);
  assert.deepEqual(await anonymousStore.getAllAlerts(), []);

  await run(() => h.desk.restoreAlerts());
  assert.ok((await accountA.getAllAlerts()).every((entry) => !entry.dismissed));
  assert.ok(h.desk.alerts.some((entry) => entry.id === alert.id));

  await run(() => h.desk.updateSettings({ locale: "ha" }));
  const stored = await accountA.getSetting<Settings>("settings");
  assert.equal(stored?.locale, "ha");
  assert.equal(await accountB.getSetting("settings"), null);
  assert.equal(await anonymousStore.getSetting("settings"), null);
});

test("deletion and dismissal bookkeeping stay in the selected account store", async (t) => {
  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  await run(() => h.desk.addThing(rentInput("To remove")));
  const removedId = h.desk.things[0].id;
  await run(() => h.desk.removeThing(removedId));

  await run(() => h.desk.addThing(rentInput("To dismiss")));
  const alert = h.desk.alerts[0];
  await run(() => h.desk.dismissAlert(alert));

  const meta = await accountA.getSetting<SyncMeta>(syncMetaKey(ownerA));
  assert.ok(meta);
  assert.equal(meta.ownerId, A_ID);
  assert.ok(meta.tombstones[removedId]);
  assert.equal(meta.pendingDismissals[alert.id].dismissed, true);

  assert.equal(await accountB.getSetting(syncMetaKey(ownerA)), null);
  assert.equal(await anonymousStore.getSetting(SYNC_META_KEY), null);
  assert.equal(await anonymousStore.getSetting(syncMetaKey(ownerA)), null);
});

test("sample data seeds only the selected store", async (t) => {
  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  await run(() => h.desk.loadSampleData());

  assert.equal((await accountA.getAllThings()).length, SEED_THINGS.length);
  assert.equal(h.desk.things.length, SEED_THINGS.length);
  assert.deepEqual(await accountB.getAllThings(), []);
  assert.deepEqual(await anonymousStore.getAllThings(), []);
});

test("deleteEverything clears only the selected store", async (t) => {
  await accountB.putThing(makeThing({ id: "b-keep" }));
  await saveSettings(accountB, { ...DEFAULT_SETTINGS, locale: "ha" });
  await anonymousStore.putThing(makeThing({ id: "anonymous-keep" }));

  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();
  await run(() => h.desk.addThing(rentInput()));
  await run(() => h.desk.updateSettings({ locale: "yo" }));

  await run(() => h.desk.deleteEverything());

  assert.deepEqual(await accountA.getAllThings(), []);
  assert.deepEqual(await loadSettings(accountA), DEFAULT_SETTINGS);
  assert.deepEqual(h.desk.things, []);
  assert.equal(h.desk.settings.locale, "en");

  assert.deepEqual((await accountB.getAllThings()).map((thing) => thing.id), ["b-keep"]);
  assert.equal((await loadSettings(accountB)).locale, "ha");
  assert.deepEqual((await anonymousStore.getAllThings()).map((thing) => thing.id), [
    "anonymous-keep",
  ]);
});

test("a delayed boot from the previous store cannot overwrite the current store", async (t) => {
  await accountA.putThing(makeThing({ id: "a-old" }));
  await accountB.putThing(makeThing({ id: "b-current" }));

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = accountA.getAllThings;
  t.mock.method(accountA, "getAllThings", async () => {
    await gate;
    return original();
  });

  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await flush(2);

  h.switchTo(accountB);
  await h.settle();
  assert.deepEqual(h.desk.things.map((thing) => thing.id), ["b-current"]);

  release();
  await flush(20);
  assert.deepEqual(h.desk.things.map((thing) => thing.id), ["b-current"]);
});

test("a delayed mutation finishes in its original store without changing the new scope", async (t) => {
  await accountB.putThing(makeThing({ id: "b-current" }));

  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = accountA.putThing;
  t.mock.method(accountA, "putThing", async (thing: Thing) => {
    await gate;
    return original(thing);
  });

  let pending!: ReturnType<Desk["addThing"]>;
  act(() => {
    pending = h.desk.addThing(rentInput("Old scope"));
  });

  h.switchTo(accountB);
  await h.settle();
  assert.deepEqual(h.desk.things.map((thing) => thing.id), ["b-current"]);

  release();
  await act(async () => {
    await pending;
  });
  await flush(12);

  assert.equal((await accountA.getAllThings()).length, 1);
  assert.deepEqual((await accountB.getAllThings()).map((thing) => thing.id), ["b-current"]);
  assert.deepEqual(await anonymousStore.getAllThings(), []);
  assert.deepEqual(h.desk.things.map((thing) => thing.id), ["b-current"]);
});

test("a delayed import cannot publish the previous store's settings", async (t) => {
  await saveSettings(accountB, { ...DEFAULT_SETTINGS, locale: "ha" });

  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = accountA.putThing;
  t.mock.method(accountA, "putThing", async (thing: Thing) => {
    await gate;
    return original(thing);
  });

  const plan: ImportPlan = {
    add: [makeThing({ id: "old-import", name: "Old import" })],
    replace: [],
    keepLocal: [],
    skipped: [],
    adjusted: 0,
    settings: { locale: "ig" },
    total: 1,
  };

  let pending!: ReturnType<Desk["importThings"]>;
  act(() => {
    pending = h.desk.importThings(plan, true);
  });

  h.switchTo(accountB);
  await h.settle();
  assert.equal(h.desk.settings.locale, "ha");

  release();
  await act(async () => {
    await pending;
  });
  await flush(12);

  assert.equal((await loadSettings(accountA)).locale, "ig");
  assert.deepEqual((await accountA.getAllThings()).map((thing) => thing.id), ["old-import"]);
  assert.equal(h.desk.settings.locale, "ha");
  assert.deepEqual(await accountB.getAllThings(), []);
});

test("the no-argument hook still targets the anonymous database", async (t) => {
  await anonymousStore.putThing(makeThing({ id: "anonymous-loaded" }));
  await saveSettings(anonymousStore, { ...DEFAULT_SETTINGS, locale: "ig" });

  const h = mountLegacyHook();
  t.after(() => h.unmount());
  await h.settle();

  assert.equal(h.desk.settings.locale, "ig");
  assert.deepEqual(h.desk.things.map((thing) => thing.id), ["anonymous-loaded"]);

  await run(() => h.desk.addThing(rentInput("Legacy add")));
  assert.equal((await anonymousStore.getAllThings()).length, 2);
  assert.deepEqual(await accountA.getAllThings(), []);
});

test("an explicit store failure is shown and never falls back to anonymous data", async (t) => {
  await anonymousStore.putThing(makeThing({ id: "anonymous-only" }));
  t.mock.method(accountA, "getAllThings", async () => {
    throw new Error("account database unavailable");
  });

  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  assert.equal(h.desk.ready, true);
  assert.equal(h.desk.loading, false);
  assert.equal(h.desk.error, "account database unavailable");
  assert.deepEqual(h.desk.things, []);
});

test("import writes land in the selected store and respect the settings opt-in", async (t) => {
  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  const plan: ImportPlan = {
    add: [makeThing({ id: "imported", name: "Imported thing" })],
    replace: [],
    keepLocal: [],
    skipped: [],
    adjusted: 0,
    settings: { locale: "ig" },
    total: 1,
  };

  await run(() => h.desk.importThings(plan, true));

  assert.deepEqual((await accountA.getAllThings()).map((thing) => thing.id), ["imported"]);
  assert.equal((await loadSettings(accountA)).locale, "ig");
  assert.deepEqual(await accountB.getAllThings(), []);
  assert.equal(await accountB.getSetting("settings"), null);
});

test("a failed explicit-store write rejects and touches no other database", async (t) => {
  const h = mountStore(accountA);
  t.after(() => h.unmount());
  await h.settle();

  const failure = new Error("write failed");
  t.mock.method(accountA, "putThing", async () => {
    throw failure;
  });
  const anonymousWrite = t.mock.method(anonymousStore, "putThing");

  await assert.rejects(h.desk.addThing(rentInput()), (error) => error === failure);

  assert.deepEqual(await accountA.getAllThings(), []);
  assert.deepEqual(await accountB.getAllThings(), []);
  assert.equal(anonymousWrite.mock.callCount(), 0);
});

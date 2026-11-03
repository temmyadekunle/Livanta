// Focused tests for the Stage 1 storage boundary in lib/db.ts.
//
// The point of these tests is scope isolation: a LocalStore may only ever
// reach its own database. They run against fake-indexeddb (in-memory), so no
// real browser database is opened or modified. Each test uses fresh user ids
// because fake-indexeddb keeps its databases for the whole process.
import test from "node:test";

import { assert, makeAlert, makeThing } from "./helpers.ts";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

// db.ts resolves indexedDB as a global, so it must be installed first.
const {
  indexedDB: fakeIndexedDB,
  IDBKeyRange,
  IDBDatabase: FakeIDBDatabase,
} = await import("fake-indexeddb");
define("IDBKeyRange", IDBKeyRange);

// Counts opens while behaving exactly like fake-indexeddb. Individual tests
// can swap in a failing factory through `useIndexedDB`.
let openCalls = 0;
const trackingIndexedDB = new Proxy(fakeIndexedDB, {
  get(target, property) {
    if (property === "open") {
      return (name: string, version?: number) => {
        openCalls += 1;
        return target.open(name, version);
      };
    }
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as IDBFactory;
define("indexedDB", trackingIndexedDB);

const {
  STORES,
  anonymousScope,
  anonymousStore,
  clearAllStores,
  closeScope,
  createLocalStore,
  databaseNameForScope,
  getAllThings,
  isValidUserId,
  openDatabase,
  putSetting,
  putThing,
  userScope,
} = await import("../lib/db.ts");

// Captured before any test runs, so importing db.ts itself must not open one.
const openCallsAtImport = openCalls;

type LocalStore = InstanceType<typeof import("../lib/db.ts").LocalStore>;
type LocalScope = import("../lib/db.ts").LocalScope;

const FIXED_USER = "11111111-1111-4111-8111-111111111111";

let userCounter = 0;
/** A valid but never-before-seen Supabase-shaped user id. */
function newUser(): string {
  userCounter += 1;
  return `00000000-0000-4000-8000-${String(userCounter).padStart(12, "0")}`;
}

function member(id: string, name: string) {
  return {
    id,
    name,
    role: "adult" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Runs a body against a temporary IDB factory, then restores the tracked one. */
async function useIndexedDB<T>(
  factory: IDBFactory,
  run: () => Promise<T>,
): Promise<T> {
  define("indexedDB", factory);
  try {
    return await run();
  } finally {
    define("indexedDB", trackingIndexedDB);
  }
}

/** A factory whose first open fails asynchronously. */
function failingOpenFactory(error: Error, attempts: { count: number }): IDBFactory {
  return {
    open() {
      attempts.count += 1;
      const request = { error } as unknown as IDBOpenDBRequest;
      setTimeout(() => request.onerror?.(new Event("error")), 0);
      return request;
    },
  } as unknown as IDBFactory;
}

/**
 * A factory that reports `blocked` and then, as the browser can, completes the
 * same request anyway. The connection that arrives late must be closed.
 */
function blockedOpenFactory(closed: { count: number }): IDBFactory {
  return {
    open() {
      const db = {
        close() {
          closed.count += 1;
        },
      } as unknown as IDBDatabase;
      const request = { result: db } as unknown as IDBOpenDBRequest;
      setTimeout(() => {
        request.onblocked?.(
          new Event("blocked") as unknown as IDBVersionChangeEvent,
        );
        request.onsuccess?.(new Event("success"));
      }, 0);
      return request;
    },
  } as unknown as IDBFactory;
}

/** Opens an existing database by name for schema inspection. */
async function inspectSchema(name: string) {
  const databases = await trackingIndexedDB.databases();
  if (!databases.some((entry) => entry.name === name)) {
    throw new Error(
      `Refusing to create ${name} just to inspect it; initialise it through the app API first.`,
    );
  }

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = trackingIndexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const stores = Array.from(db.objectStoreNames).sort();
    const tx = db.transaction(stores, "readonly");
    const details = Object.fromEntries(
      stores.map((store) => {
        const objectStore = tx.objectStore(store);
        return [
          store,
          {
            keyPath: objectStore.keyPath,
            indexes: Array.from(objectStore.indexNames).sort(),
          },
        ];
      }),
    );
    return { version: db.version, stores, details };
  } finally {
    db.close();
  }
}

function invalidStateError(): Error {
  const error = new Error("The database connection is closing.");
  error.name = "InvalidStateError";
  return error;
}

function isInvalidStateName(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "InvalidStateError"
  );
}

test("importing db.ts does not open a database", () => {
  assert.equal(openCallsAtImport, 0);
});

test("anonymous scope is the existing lifedesk database", () => {
  assert.equal(databaseNameForScope(anonymousScope()), "lifedesk");
  assert.equal(anonymousStore.databaseName, "lifedesk");
  assert.equal(databaseNameForScope({ kind: "anonymous" }), "lifedesk");
});

test("account database names derive only from a validated user id", () => {
  const id = newUser();
  assert.equal(databaseNameForScope(userScope(id)), `lifedesk:user:${id}`);
  assert.equal(userScope(id).kind, "user");
});

test("user ids are case-normalised so one account keeps one database", () => {
  const lower = FIXED_USER.toLowerCase();
  assert.equal(
    databaseNameForScope(userScope(FIXED_USER.toUpperCase())),
    `lifedesk:user:${lower}`,
  );
  assert.equal(databaseNameForScope(userScope(lower)), `lifedesk:user:${lower}`);
});

test("invalid user ids are rejected rather than becoming database names", () => {
  const id = newUser();
  for (const bad of [
    "",
    "not-a-uuid",
    "Ada Lovelace",
    "ada@example.com",
    `${id}:other`,
    `${id} `,
    "11111111111141118111111111111111",
    "../../lifedesk",
  ]) {
    assert.equal(isValidUserId(bad), false, bad);
    assert.throws(() => userScope(bad), /valid Supabase user id/, bad);
  }
  assert.equal(isValidUserId(id), true);
  assert.equal(isValidUserId(123), false);
  assert.equal(isValidUserId(null), false);
});

test("invalid scope objects are rejected", () => {
  assert.throws(() => createLocalStore(null as unknown as LocalScope));
  assert.throws(() =>
    createLocalStore({ kind: "user", userId: "nope" } as LocalScope),
  );
  assert.throws(() =>
    createLocalStore({ kind: "bogus" } as unknown as LocalScope),
  );
});

test("openDatabase still resolves the anonymous database", async () => {
  const db = await openDatabase();
  assert.equal(db.name, "lifedesk");
});

test("two stores for the same scope share records and one database", async () => {
  const id = newUser();
  const first = createLocalStore(userScope(id));
  const second = createLocalStore(userScope(id));

  assert.equal(first.databaseName, second.databaseName);
  await first.putThing(makeThing({ id: "shared-thing" }));

  const seen = await second.getAllThings();
  assert.deepEqual(
    seen.map((thing) => thing.id),
    ["shared-thing"],
  );
});

test("stores for different scopes cannot see each other's records", async () => {
  const a = createLocalStore(userScope(newUser()));
  const b = createLocalStore(userScope(newUser()));

  await a.putThing(makeThing({ id: "a-thing" }));
  await a.putSetting("settings", { owner: "A" });
  await a.putAlert(makeAlert({ id: "a-alert" }));
  await a.putMember(member("a-member", "Ade"));

  assert.deepEqual(await b.getAllThings(), []);
  assert.equal(await b.getSetting("settings"), null);
  assert.deepEqual(await b.getAllAlerts(), []);
  assert.deepEqual(await b.getAllMembers(), []);

  assert.deepEqual(
    (await a.getAllThings()).map((thing) => thing.id),
    ["a-thing"],
  );
});

test("account writes never reach the anonymous database", async () => {
  await clearAllStores();
  const a = createLocalStore(userScope(newUser()));

  await a.putThing(makeThing({ id: "account-only" }));

  assert.deepEqual(await anonymousStore.getAllThings(), []);
  // The legacy wrappers are fixed to the anonymous scope and see nothing.
  assert.deepEqual(await getAllThings(), []);
});

test("a record in one scope cannot be updated or deleted from another", async () => {
  const a = createLocalStore(userScope(newUser()));
  const b = createLocalStore(userScope(newUser()));

  await a.putThing(makeThing({ id: "a-thing", name: "Original" }));
  await b.putThing(makeThing({ id: "a-thing", name: "Impostor" }));
  await b.deleteThing("a-thing");

  const [stored] = await a.getAllThings();
  assert.equal(stored.name, "Original");
  assert.equal((await b.getAllThings()).length, 0);
});

test("clearing one scope leaves every other scope intact", async () => {
  const a = createLocalStore(userScope(newUser()));
  const b = createLocalStore(userScope(newUser()));

  await clearAllStores();
  await a.putThing(makeThing({ id: "a-thing" }));
  await a.putAlert(makeAlert({ id: "a-alert" }));
  await a.putMember(member("a-member", "Ade"));
  await a.putSetting("settings", { owner: "A" });

  await b.putThing(makeThing({ id: "b-thing" }));
  await b.putSetting("settings", { owner: "B" });
  await putThing(makeThing({ id: "anon-thing" }));
  await putSetting("settings", { owner: "anonymous" });

  await a.clear();

  assert.deepEqual(await a.getAllThings(), []);
  assert.deepEqual(await a.getAllAlerts(), []);
  assert.deepEqual(await a.getAllMembers(), []);
  assert.equal(await a.getSetting("settings"), null);

  assert.deepEqual(
    (await b.getAllThings()).map((thing) => thing.id),
    ["b-thing"],
  );
  assert.deepEqual(await b.getSetting("settings"), { owner: "B" });

  assert.deepEqual(
    (await anonymousStore.getAllThings()).map((thing) => thing.id),
    ["anon-thing"],
  );
  assert.deepEqual(await anonymousStore.getSetting("settings"), {
    owner: "anonymous",
  });
});

test("legacy clearAllStores clears only the anonymous database", async () => {
  const a = createLocalStore(userScope(newUser()));
  await a.putThing(makeThing({ id: "a-thing" }));
  await putThing(makeThing({ id: "anon-thing" }));

  await clearAllStores();

  assert.deepEqual(await anonymousStore.getAllThings(), []);
  assert.deepEqual(
    (await a.getAllThings()).map((thing) => thing.id),
    ["a-thing"],
  );
});

test("creating an account store never copies anonymous data into it", async () => {
  await clearAllStores();
  await putThing(makeThing({ id: "anonymous-record" }));
  await putSetting("settings", { owner: "anonymous" });

  const a = createLocalStore(userScope(newUser()));

  assert.deepEqual(await a.getAllThings(), []);
  assert.equal(await a.getSetting("settings"), null);
  // And the original is neither moved nor deleted.
  assert.deepEqual(
    (await getAllThings()).map((thing) => thing.id),
    ["anonymous-record"],
  );
  assert.deepEqual(await anonymousStore.getSetting("settings"), {
    owner: "anonymous",
  });
});

test("every scope keeps the existing v2 schema, stores and key paths", async () => {
  // The anonymous database only exists once the app has opened it. Opening it
  // here makes this test independent of execution order and guarantees the
  // inspected schema was created through the version-2 code path.
  await openDatabase();

  const a = createLocalStore(userScope(newUser()));
  const b = createLocalStore(userScope(newUser()));
  await a.putThing(makeThing({ id: "a-thing" }));
  await b.putThing(makeThing({ id: "b-thing" }));

  const expectedStores = ["alerts", "members", "settings", "things"];
  const expectedKeyPaths: Record<string, string> = {
    [STORES.things]: "id",
    [STORES.alerts]: "id",
    [STORES.members]: "id",
    [STORES.settings]: "key",
  };
  const expectedIndexes: Record<string, string[]> = {
    [STORES.things]: [
      "by-category",
      "by-dueDate",
      "by-priority",
      "by-status",
    ],
    [STORES.alerts]: ["by-priority", "by-thingId"],
    [STORES.members]: [],
    [STORES.settings]: [],
  };

  for (const name of ["lifedesk", a.databaseName, b.databaseName]) {
    const schema = await inspectSchema(name);
    assert.equal(schema.version, 2, `${name} version`);
    assert.deepEqual(schema.stores, expectedStores, `${name} stores`);
    for (const store of expectedStores) {
      assert.equal(
        schema.details[store].keyPath,
        expectedKeyPaths[store],
        `${name}/${store} key path`,
      );
      assert.deepEqual(
        schema.details[store].indexes,
        expectedIndexes[store],
        `${name}/${store} indexes`,
      );
    }
  }
});

test("a store created later still targets only its own database", async () => {
  const a = createLocalStore(userScope(newUser()));
  await a.putThing(makeThing({ id: "a-thing" }));

  // Created after A's connection already exists, so a cached handle must not
  // be reused across scopes.
  const bStore: LocalStore = createLocalStore(userScope(newUser()));

  assert.deepEqual(await bStore.getAllThings(), []);
  assert.deepEqual(
    (await a.getAllThings()).map((thing) => thing.id),
    ["a-thing"],
  );
});

test("a failed open is evicted and a later attempt succeeds", async () => {
  const store = createLocalStore(userScope(newUser()));
  const attempts = { count: 0 };

  await useIndexedDB(
    failingOpenFactory(new Error("simulated open failure"), attempts),
    async () => {
      await assert.rejects(store.getAllThings(), /simulated open failure/);
    },
  );

  assert.equal(attempts.count, 1);
  const opensBeforeRetry = openCalls;
  await store.putThing(makeThing({ id: "retry-thing" }));
  assert.equal(openCalls, opensBeforeRetry + 1);
  assert.deepEqual(
    (await store.getAllThings()).map((thing) => thing.id),
    ["retry-thing"],
  );
});

test("a blocked open that later succeeds closes the orphaned connection", async () => {
  const store = createLocalStore(userScope(newUser()));
  const closed = { count: 0 };

  await useIndexedDB(blockedOpenFactory(closed), async () => {
    await assert.rejects(store.getAllThings(), /blocked/);
  });

  // The request completed after the wrapper rejected; nothing owns that handle.
  assert.equal(closed.count, 1);

  // Rejection evicted the entry, so the next attempt opens normally.
  await store.putThing(makeThing({ id: "after-block" }));
  assert.deepEqual(
    (await store.getAllThings()).map((thing) => thing.id),
    ["after-block"],
  );
});

test("concurrent callers share a single open request", async () => {
  const store = createLocalStore(userScope(newUser()));
  const opensBefore = openCalls;

  await Promise.all([store.getAllThings(), store.getAllAlerts()]);

  assert.equal(openCalls, opensBefore + 1);
});

test("repeated operations reuse the cached handle", async () => {
  const store = createLocalStore(userScope(newUser()));
  const opensBefore = openCalls;

  await store.putThing(makeThing({ id: "reused" }));
  await store.getAllThings();
  await store.getSetting("settings");
  await store.getAllAlerts();

  assert.equal(openCalls, opensBefore + 1);
});

test("closeScope closes, evicts, repeats safely, and keeps the data", async () => {
  const scope = userScope(newUser());
  const store = createLocalStore(scope);
  await store.putThing(makeThing({ id: "kept" }));

  const originalClose = FakeIDBDatabase.prototype.close;
  let closes = 0;
  FakeIDBDatabase.prototype.close = function (this: IDBDatabase) {
    closes += 1;
    return originalClose.call(this);
  };
  try {
    await closeScope(scope);
    await closeScope(scope);
    await closeScope(scope);
  } finally {
    FakeIDBDatabase.prototype.close = originalClose;
  }

  assert.equal(closes, 1);

  // The connection was evicted, so the next read reopens; the record proves
  // the database itself was not deleted.
  const opensBeforeReopen = openCalls;
  assert.deepEqual(
    (await store.getAllThings()).map((thing) => thing.id),
    ["kept"],
  );
  assert.equal(openCalls, opensBeforeReopen + 1);
});

test("a version change closes and evicts the cached connection", async () => {
  const id = newUser();
  const scope = userScope(id);
  const store = createLocalStore(scope);
  await store.putThing(makeThing({ id: "before-upgrade" }));

  const originalClose = FakeIDBDatabase.prototype.close;
  let closes = 0;
  FakeIDBDatabase.prototype.close = function (this: IDBDatabase) {
    closes += 1;
    return originalClose.call(this);
  };

  let upgraded: IDBDatabase | undefined;
  try {
    upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = trackingIndexedDB.open(`lifedesk:user:${id}`, 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    assert.equal(closes, 1);
  } finally {
    FakeIDBDatabase.prototype.close = originalClose;
    upgraded?.close();
  }

  // The eviction means there is nothing left for closeScope to close.
  await closeScope(scope);
});

test("a transaction that cannot start on a closed connection is retried once", async () => {
  const store = createLocalStore(userScope(newUser()));
  await store.putThing(makeThing({ id: "before-recovery" }));

  const originalTransaction = FakeIDBDatabase.prototype.transaction;
  let attempts = 0;
  FakeIDBDatabase.prototype.transaction = function (
    this: IDBDatabase,
    storeNames: string | string[],
    mode?: IDBTransactionMode,
  ) {
    if (mode === "versionchange") {
      return originalTransaction.call(this, storeNames, mode);
    }
    attempts += 1;
    if (attempts === 1) throw invalidStateError();
    return originalTransaction.call(this, storeNames, mode);
  } as typeof FakeIDBDatabase.prototype.transaction;

  const opensBefore = openCalls;
  try {
    await store.putThing(makeThing({ id: "after-recovery" }));
  } finally {
    FakeIDBDatabase.prototype.transaction = originalTransaction;
  }

  assert.equal(attempts, 2);
  assert.equal(openCalls, opensBefore + 1);
  assert.deepEqual(
    (await store.getAllThings()).map((thing) => thing.id).sort(),
    ["after-recovery", "before-recovery"],
  );
});

test("a repeated connection failure is not retried again", async () => {
  const store = createLocalStore(userScope(newUser()));
  await store.putThing(makeThing({ id: "seed" }));

  const originalTransaction = FakeIDBDatabase.prototype.transaction;
  let attempts = 0;
  FakeIDBDatabase.prototype.transaction = function (
    this: IDBDatabase,
    storeNames: string | string[],
    mode?: IDBTransactionMode,
  ) {
    if (mode === "versionchange") {
      return originalTransaction.call(this, storeNames, mode);
    }
    attempts += 1;
    throw invalidStateError();
  } as typeof FakeIDBDatabase.prototype.transaction;

  try {
    await assert.rejects(store.getAllThings(), isInvalidStateName);
  } finally {
    FakeIDBDatabase.prototype.transaction = originalTransaction;
  }

  assert.equal(attempts, 2);
});

test("a failure after a transaction starts is never retried", async () => {
  const store = createLocalStore(userScope(newUser()));
  await store.putThing(makeThing({ id: "seed" }));

  const originalTransaction = FakeIDBDatabase.prototype.transaction;
  let attempts = 0;
  FakeIDBDatabase.prototype.transaction = function (
    this: IDBDatabase,
    storeNames: string | string[],
    mode?: IDBTransactionMode,
  ) {
    if (mode === "versionchange") {
      return originalTransaction.call(this, storeNames, mode);
    }
    attempts += 1;
    return {
      objectStore() {
        throw invalidStateError();
      },
    } as unknown as IDBTransaction;
  } as typeof FakeIDBDatabase.prototype.transaction;

  try {
    await assert.rejects(
      store.putThing(makeThing({ id: "uncertain" })),
      isInvalidStateName,
    );
  } finally {
    FakeIDBDatabase.prototype.transaction = originalTransaction;
  }

  assert.equal(attempts, 1);
});

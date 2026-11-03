import type { Alert, HouseholdMember, Thing } from "./types.ts";

// Internal storage key, deliberately NOT the product name. It is the
// IndexedDB database users' records live in, so changing it would orphan
// existing data with no server copy to recover from. Renamed products must
// leave this alone unless a migration is written alongside it.
const DB_NAME = "lifedesk";
const DB_VERSION = 2;

export const STORES = {
  things: "things",
  alerts: "alerts",
  members: "members",
  settings: "settings",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/**
 * A local data scope.
 *
 * The anonymous scope is the existing `lifedesk` database. An account scope
 * is a separate database named from the validated Supabase user id, so two
 * accounts on one device cannot read, write or clear each other's records.
 *
 * The anonymous scope is the default for every existing caller; the
 * compatibility wrappers at the bottom of this module always use it.
 */
export type LocalScope =
  | { readonly kind: "anonymous" }
  | { readonly kind: "user"; readonly userId: string };

const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ANONYMOUS_SCOPE: LocalScope = Object.freeze({ kind: "anonymous" });

/** True for the UUID form Supabase uses for `auth.users.id`. */
export function isValidUserId(value: unknown): value is string {
  return typeof value === "string" && USER_ID_PATTERN.test(value);
}

export function anonymousScope(): LocalScope {
  return ANONYMOUS_SCOPE;
}

/**
 * Builds a validated account scope. Lower-casing keeps one database per user
 * even if a caller passes the UUID in a different case; the regex rejects
 * anything that is not a UUID, so the id cannot alter the database name.
 */
export function userScope(userId: string): LocalScope {
  if (!isValidUserId(userId)) {
    throw new Error("A local account scope requires a valid Supabase user id.");
  }
  const scope: LocalScope = { kind: "user", userId: userId.toLowerCase() };
  return Object.freeze(scope);
}

function normalizeScope(scope: LocalScope): LocalScope {
  if (!scope || typeof scope !== "object") {
    throw new Error("A local scope is required.");
  }
  if (scope.kind === "anonymous") return ANONYMOUS_SCOPE;
  if (scope.kind === "user") return userScope(scope.userId);
  throw new Error("Unknown local scope.");
}

/** The only place a database name is derived from a scope. */
export function databaseNameForScope(scope: LocalScope): string {
  const normalized = normalizeScope(scope);
  if (normalized.kind === "anonymous") return DB_NAME;
  return `${DB_NAME}:user:${normalized.userId}`;
}

function indexedDBFactory(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error(
      "IndexedDB is unavailable. Livanta data is browser-local and requires a client environment.",
    );
  }
  return indexedDB;
}

// One open handle per database. Every LocalStore for the same scope shares
// the connection, and a store can only ever address its own database name.
const handleCache = new Map<string, Promise<IDBDatabase>>();

function openDatabaseByName(name: string): Promise<IDBDatabase> {
  const cached = handleCache.get(name);
  if (cached) return cached;

  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDBFactory().open(name, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      // Evict only this attempt. A late failure must never discard a newer
      // connection cached under the same name.
      if (handleCache.get(name) === pending) handleCache.delete(name);
      reject(error);
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORES.things)) {
        const things = db.createObjectStore(STORES.things, { keyPath: "id" });
        things.createIndex("by-category", "category", { unique: false });
        things.createIndex("by-dueDate", "dueDate", { unique: false });
        things.createIndex("by-status", "status", { unique: false });
        things.createIndex("by-priority", "priority", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.alerts)) {
        const alerts = db.createObjectStore(STORES.alerts, { keyPath: "id" });
        alerts.createIndex("by-thingId", "thingId", { unique: false });
        alerts.createIndex("by-priority", "priority", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.members)) {
        db.createObjectStore(STORES.members, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      // A blocked attempt rejects, but its request can still complete later
      // when the other connection closes. Close that orphan so it is not a
      // connection nobody owns or can ever close.
      if (settled) {
        db.close();
        return;
      }

      settled = true;
      db.onversionchange = () => {
        db.close();
        if (handleCache.get(name) === pending) handleCache.delete(name);
      };
      db.onclose = () => {
        if (handleCache.get(name) === pending) handleCache.delete(name);
      };
      resolve(db);
    };

    request.onerror = () => fail(request.error);
    request.onblocked = () =>
      fail(new Error("Database upgrade blocked by another open tab."));
  });

  handleCache.set(name, pending);
  // A synchronous factory failure rejects before the entry is cached, so
  // eviction also has to happen here, not only inside `fail`.
  void pending.catch(() => {
    if (handleCache.get(name) === pending) handleCache.delete(name);
  });
  return pending;
}

/**
 * The anonymous database handle, kept for compatibility. New code should use
 * a LocalStore so it cannot accidentally address an account database.
 */
export function openDatabase(): Promise<IDBDatabase> {
  return openDatabaseByName(DB_NAME);
}

/**
 * Closes and forgets the cached connection for a scope, so the next operation
 * reopens it. Safe to call repeatedly, and safe while an open is still
 * pending. The database and its records are untouched: this is the building
 * block for future scope transitions, not a delete.
 */
export async function closeScope(scope: LocalScope): Promise<void> {
  const name = databaseNameForScope(scope);
  const cached = handleCache.get(name);
  if (!cached) return;

  // Forget the entry first so no new operation can reuse a connection that is
  // about to be closed.
  handleCache.delete(name);
  try {
    const db = await cached;
    db.close();
  } catch {
    // An open that never succeeded has no connection to close; eviction is
    // the whole job in that case.
  }
}

/**
 * Raised when a transaction cannot start because the cached connection was
 * closed. Only this error is retried: no statement ran, so a retry cannot
 * duplicate a write.
 */
class StoreConnectionLostError extends Error {
  constructor() {
    super("The local database connection was closed.");
    this.name = "InvalidStateError";
  }
}

function isInvalidStateError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "InvalidStateError"
  );
}

/**
 * Drops `db` from the cache only if it is still the cached connection, then
 * closes it. A newer connection installed by another caller is left alone.
 */
async function forgetHandle(name: string, db: IDBDatabase): Promise<void> {
  const cached = handleCache.get(name);
  if (!cached) return;

  try {
    const current = await cached;
    if (current !== db) return;
  } catch {
    return;
  }

  handleCache.delete(name);
  try {
    db.close();
  } catch {
    // Already closed by the versionchange handler.
  }
}

function run<T>(
  db: IDBDatabase,
  store: StoreName,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(store, mode);
    } catch (error) {
      reject(
        isInvalidStateError(error) ? new StoreConnectionLostError() : error,
      );
      return;
    }

    let request: IDBRequest;
    try {
      request = work(tx.objectStore(store));
    } catch (error) {
      // The transaction already started, so retrying could duplicate work.
      reject(error);
      return;
    }

    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function clearStores(db: IDBDatabase): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(Object.values(STORES), "readwrite");
    } catch (error) {
      reject(
        isInvalidStateError(error) ? new StoreConnectionLostError() : error,
      );
      return;
    }

    for (const name of Object.values(STORES)) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error ?? new Error("The clear transaction was aborted."));
  });
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface SettingRow<T> {
  key: string;
  value: T;
}

/**
 * A database-bound view of the local records.
 *
 * Every method opens (or reuses) the connection for this store's own
 * database name. There is no ambient "active scope", so a write can never
 * land in a database other than the one the store was created for.
 */
export class LocalStore {
  readonly scope: LocalScope;
  readonly databaseName: string;

  constructor(scope: LocalScope) {
    this.scope = normalizeScope(scope);
    this.databaseName = databaseNameForScope(this.scope);
  }

  /**
   * Runs one operation against this store's database. A connection that was
   * closed underneath us is replaced and the operation is retried exactly
   * once; any other failure, or a failure after a transaction started, is
   * returned to the caller untouched.
   */
  private async withDatabase<T>(
    work: (db: IDBDatabase) => Promise<T>,
  ): Promise<T> {
    const first = await openDatabaseByName(this.databaseName);
    try {
      return await work(first);
    } catch (error) {
      if (!(error instanceof StoreConnectionLostError)) throw error;
      await forgetHandle(this.databaseName, first);
      const second = await openDatabaseByName(this.databaseName);
      return work(second);
    }
  }

  getAllThings = (): Promise<Thing[]> =>
    this.withDatabase(async (db) => {
      const things = await run<Thing[]>(
        db,
        STORES.things,
        "readonly",
        (s) => s.getAll(),
      );
      // Amounts saved before parseAmount existed can be NaN in IndexedDB, and
      // NaN renders as "₦NaN" while poisoning every sum it joins. Repairing on
      // read fixes existing users without a schema version bump. Only genuinely
      // corrupt records are written back, so a healthy database is never touched.
      const repaired = things.map((thing) =>
        thing.amount === null || Number.isFinite(thing.amount)
          ? thing
          : { ...thing, amount: null },
      );
      for (const [i, thing] of repaired.entries()) {
        if (thing !== things[i]) await this.putThing(thing);
      }
      return repaired;
    });

  putThing = (thing: Thing): Promise<IDBValidKey> =>
    this.withDatabase((db) =>
      run<IDBValidKey>(db, STORES.things, "readwrite", (s) => s.put(thing)),
    );

  deleteThing = (id: string): Promise<undefined> =>
    this.withDatabase((db) =>
      run<undefined>(db, STORES.things, "readwrite", (s) => s.delete(id)),
    );

  getAllAlerts = (): Promise<Alert[]> =>
    this.withDatabase((db) =>
      run<Alert[]>(db, STORES.alerts, "readonly", (s) => s.getAll()),
    );

  putAlert = (alert: Alert): Promise<IDBValidKey> =>
    this.withDatabase((db) =>
      run<IDBValidKey>(db, STORES.alerts, "readwrite", (s) => s.put(alert)),
    );

  deleteAlert = (id: string): Promise<undefined> =>
    this.withDatabase((db) =>
      run<undefined>(db, STORES.alerts, "readwrite", (s) => s.delete(id)),
    );

  clearAlerts = (): Promise<undefined> =>
    this.withDatabase((db) =>
      run<undefined>(db, STORES.alerts, "readwrite", (s) => s.clear()),
    );

  getAllMembers = (): Promise<HouseholdMember[]> =>
    this.withDatabase((db) =>
      run<HouseholdMember[]>(db, STORES.members, "readonly", (s) => s.getAll()),
    );

  putMember = (member: HouseholdMember): Promise<IDBValidKey> =>
    this.withDatabase((db) =>
      run<IDBValidKey>(db, STORES.members, "readwrite", (s) => s.put(member)),
    );

  getSetting = <T>(key: string): Promise<T | null> =>
    this.withDatabase(async (db) => {
      const row = await run<SettingRow<T> | undefined>(
        db,
        STORES.settings,
        "readonly",
        (s) => s.get(key),
      );
      return row ? row.value : null;
    });

  putSetting = <T>(key: string, value: T): Promise<IDBValidKey> =>
    this.withDatabase((db) =>
      run<IDBValidKey>(db, STORES.settings, "readwrite", (s) =>
        s.put({ key, value }),
      ),
    );

  /**
   * Wipes every store in this scope's database, and no other scope. This is
   * the scope-safe replacement for the legacy device-wide wipe.
   */
  clear = (): Promise<void> => this.withDatabase(clearStores);
}

export function createLocalStore(scope: LocalScope): LocalStore {
  return new LocalStore(scope);
}

/** The existing, signed-out database. */
export const anonymousStore: LocalStore = createLocalStore(ANONYMOUS_SCOPE);

/* Compatibility wrappers. Every existing caller keeps operating on the
   anonymous `lifedesk` database exactly as before. */

export function getAllThings(): Promise<Thing[]> {
  return anonymousStore.getAllThings();
}

export function putThing(thing: Thing): Promise<IDBValidKey> {
  return anonymousStore.putThing(thing);
}

export function deleteThing(id: string): Promise<undefined> {
  return anonymousStore.deleteThing(id);
}

export function getAllAlerts(): Promise<Alert[]> {
  return anonymousStore.getAllAlerts();
}

export function putAlert(alert: Alert): Promise<IDBValidKey> {
  return anonymousStore.putAlert(alert);
}

export function deleteAlert(id: string): Promise<undefined> {
  return anonymousStore.deleteAlert(id);
}

export function clearAlerts(): Promise<undefined> {
  return anonymousStore.clearAlerts();
}

export function getAllMembers(): Promise<HouseholdMember[]> {
  return anonymousStore.getAllMembers();
}

export function putMember(member: HouseholdMember): Promise<IDBValidKey> {
  return anonymousStore.putMember(member);
}

export function getSetting<T>(key: string): Promise<T | null> {
  return anonymousStore.getSetting<T>(key);
}

export function putSetting<T>(key: string, value: T): Promise<IDBValidKey> {
  return anonymousStore.putSetting<T>(key, value);
}

/**
 * Wipes every store in the anonymous database. Account scopes can only be
 * cleared through their own LocalStore.
 */
export function clearAllStores(): Promise<void> {
  return anonymousStore.clear();
}

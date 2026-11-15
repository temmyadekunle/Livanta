/**
 * F1 and F2, end to end through AppEntry.
 *
 * These tests drive the real entry component with a recording Supabase client
 * and a recording reminder adapter. Nothing here calls `handleSignOut`: the
 * point of F1 is that a session Supabase ends on its own (expiry, or another
 * tab replacing it) must still tear the account down, even though LivantaApp is
 * remounted on the auth-status change. F2 is the same boundary from the other
 * side: a new session must not be published over an account whose teardown has
 * not succeeded.
 *
 * The auth client is replaced through `setSupabaseForTesting`, so the tests run
 * the production `useAuth` and entry logic rather than a stub of them.
 */

import test from "node:test";
import { register } from "node:module";

register("./tsx-loader.mjs", import.meta.url);

// Must be set before the client module is loaded: it captures the pair at
// module scope, exactly as a Next build would inline it.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://livanta-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

import { assert, makeThing } from "./helpers.ts";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { Window } = await import("happy-dom");
const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");

const win = new Window({ url: "https://livanta.test/" });
define("window", win);
define("document", win.document);
define("navigator", win.navigator);
define("location", win.location);
define("indexedDB", indexedDB);
define("IDBKeyRange", IDBKeyRange);
define("IS_REACT_ACT_ENVIRONMENT", true);

// React loads after the globals so it sees a client environment.
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { default: AppEntry } = await import("../components/AppEntry.tsx");
const { getAccountTransitionCoordinator, resetAccountTransitionForTesting } =
  await import("../lib/accountTransition.ts");
const { en } = await import("../lib/locales/en.ts");
const { markIntroductionCompleted } = await import("../lib/introduction.ts");
const { resetAuthForTesting } = await import("../lib/useAuth.ts");
const { setSupabaseForTesting } = await import("../lib/supabase/client.ts");
const { setLockManager } = await import("../lib/identityLock.ts");
const { resetIdentityChannelForTesting } = await import(
  "../lib/identityTransition.ts"
);
const { setIdentityTransportForTesting } = await import(
  "../lib/identityTransport.ts"
);
const {
  setReminderAdapterForTesting,
  resetReminderSchedulingForTesting,
} = await import("../lib/schedule.ts");
const {
  OWNER_MARKER_KEY,
  readReminderMarker,
  reminderOwnerHash,
  beginReminderTransition,
  completeReminderTransition,
  setReminderOwnerStorageForTesting,
} = await import("../lib/reminders/ownerMarker.ts");
const { setSessionTimeoutForTesting } = await import("../lib/sessionTimeout.ts");

type Session = import("@supabase/supabase-js").Session;
type Root = import("react-dom/client").Root;

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const C_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const D_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
const E_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";
const F_ID = "ffffffff-ffff-4fff-8fff-fffffffffff6";
const G_ID = "11111111-1111-4111-8111-111111111117";
const H_ID = "22222222-2222-4222-8222-222222222228";

function sessionFor(id: string, email: string): Session {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: {
      id,
      email,
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00.000Z",
      app_metadata: {},
      user_metadata: {},
    },
  } as unknown as Session;
}

type AuthEvent = Parameters<
  Parameters<
    import("@supabase/supabase-js").SupabaseClient["auth"]["onAuthStateChange"]
  >[0]
>[0];

interface FakeClient {
  auth: {
    getSession: () => Promise<{ data: { session: Session | null }; error: null }>;
    onAuthStateChange: (
      callback: (event: AuthEvent, session: Session | null) => void,
    ) => { data: { subscription: { unsubscribe: () => void } } };
    signOut: () => Promise<{ error: null }>;
    signInWithPassword: () => Promise<{ data: unknown; error: null }>;
    signUp: () => Promise<{ data: { session: null; user: null }; error: null }>;
    resetPasswordForEmail: () => Promise<{ error: null }>;
    updateUser: () => Promise<{ error: null }>;
    signInWithOAuth: () => Promise<{ error: null }>;
  };
  /** Replaces the persisted session, as another tab's sign-in would. */
  setSession: (session: Session | null) => void;
  /** Delivers the auth event Supabase would emit for that session. */
  emit: (event: AuthEvent, session: Session | null) => void;
  /** Whether useAuth has subscribed and read the session, for diagnostics. */
  readonly subscribed: boolean;
  readonly reads: number;
}

function fakeClient(initial: Session | null): FakeClient {
  let current = initial;
  let listener: ((event: AuthEvent, session: Session | null) => void) | null = null;
  let subscribed = false;
  let reads = 0;
  const client: FakeClient = {
    auth: {
      getSession: async () => {
        reads += 1;
        return { data: { session: current }, error: null };
      },
      onAuthStateChange: (callback) => {
        listener = callback;
        subscribed = true;
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                listener = null;
              },
            },
          },
        };
      },
      signOut: async () => {
        current = null;
        listener?.("SIGNED_OUT", null);
        return { error: null };
      },
      signInWithPassword: async () => ({ data: {}, error: null }),
      signUp: async () => ({ data: { session: null, user: null }, error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      signInWithOAuth: async () => ({ error: null }),
    },
    setSession(session) {
      current = session;
    },
    emit(event, session) {
      current = session;
      listener?.(event, session);
    },
    get subscribed() {
      return subscribed;
    },
    get reads() {
      return reads;
    },
  };
  return client;
}

type Adapter = {
  ops: string[];
  cancels: number;
  failing: boolean;
  onCancel: (() => void) | null;
  holdNextCancel: () => void;
  releaseCancel: () => void;
  blocked: () => boolean;
  checkPermissions: () => Promise<{ display: string }>;
  requestPermissions: () => Promise<{ display: string }>;
  cancelAll: () => Promise<void>;
  schedule: () => Promise<void>;
};

function recordingAdapter(): Adapter {
  let hold = false;
  let release: (() => void) | null = null;
  let blocked = false;
  const adapter: Adapter = {
    ops: [],
    cancels: 0,
    failing: false,
    onCancel: null,
    holdNextCancel() {
      hold = true;
    },
    releaseCancel() {
      blocked = false;
      release?.();
      release = null;
    },
    blocked: () => blocked,
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    cancelAll: async () => {
      adapter.cancels += 1;
      adapter.ops.push("cancel");
      adapter.onCancel?.();
      if (adapter.failing) throw new Error("plugin refused");
      if (hold) {
        hold = false;
        blocked = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        blocked = false;
      }
    },
    schedule: async () => {
      adapter.ops.push("schedule");
    },
  };
  return adapter;
}

function workingLocks() {
  const counter = { requests: 0 };
  return {
    counter,
    request: async (
      _name: string,
      _options: { signal: AbortSignal },
      callback: () => Promise<void>,
    ) => {
      counter.requests += 1;
      await callback();
    },
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitUntil(
  check: () => boolean,
  label: string,
  details?: () => string,
): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    // React 19 holds updates scheduled inside one long async act() until that
    // act exits, so a single polling act would never observe the commit. Each
    // poll is its own short act, which commits whatever settled meanwhile
    // before the next check reads the DOM.
    await act(async () => {
      await delay(5);
    });
  }
  throw new Error(
    `Timed out waiting for ${label}${details ? `; ${details()}` : ""}`,
  );
}

interface Mounted {
  container: Element;
  root: Root;
  text: () => string;
  unmount: () => Promise<void>;
}

const mounted: Mounted[] = [];

async function mountEntry(): Promise<Mounted> {
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const app: Mounted = {
    container: container as unknown as Element,
    root,
    text: () => container.textContent ?? "",
    async unmount() {
      await act(async () => {
        await delay(30);
        root.unmount();
      });
    },
  };
  mounted.push(app);
  act(() => {
    root.render(<AppEntry />);
  });
  return app;
}

async function mountApp(): Promise<Mounted> {
  const app = await mountEntry();
  try {
    await waitUntil(
      () => getAccountTransitionCoordinator().currentUserId() !== null,
      "the initial account to register",
    );
  } catch (error) {
    throw new Error(
      `${(error as Error).message}; subscribed=${client.subscribed} reads=${client.reads} text=${JSON.stringify(
        app.text(),
      )}`,
    );
  }
  return app;
}

let client: FakeClient;
let adapter: Adapter;
let locks: ReturnType<typeof workingLocks>;
let device: Map<string, string>;

test.beforeEach(async () => {
  resetAuthForTesting();
  resetAccountTransitionForTesting();
  resetReminderSchedulingForTesting();
  resetIdentityChannelForTesting();
  setIdentityTransportForTesting(null);
  setSupabaseForTesting(null);

  // The native plugin and the device marker both survive a page reload; the
  // auth store and coordinator deliberately do not.
  device = new Map();
  setReminderOwnerStorageForTesting({
    getItem: (key) => device.get(key) ?? null,
    setItem: (key, value) => {
      device.set(key, value);
    },
  });

  client = fakeClient(null);
  adapter = recordingAdapter();
  locks = workingLocks();
  setSupabaseForTesting(client as unknown as import("@supabase/supabase-js").SupabaseClient);
  setReminderAdapterForTesting(adapter);
  setLockManager(locks);
  markIntroductionCompleted();
});

test.afterEach(async () => {
  while (mounted.length > 0) {
    const app = mounted.pop();
    if (app) await app.unmount();
  }
  // The last account in a test stays signed in; release its store so the fake
  // IndexedDB connection does not outlive the test process.
  const store = getAccountTransitionCoordinator().currentStore();
  if (store && !store.closed) await store.close();
});

test.after(() => {
  setIdentityTransportForTesting(null);
  resetIdentityChannelForTesting();
  setLockManager(null);
  setSupabaseForTesting(null);
  setReminderOwnerStorageForTesting(null);
  resetReminderSchedulingForTesting();
});

async function startSignedIn(id: string): Promise<Mounted> {
  client.setSession(sessionFor(id, `${id}@example.com`));
  const app = await mountApp();
  assert.equal(getAccountTransitionCoordinator().currentUserId(), id);
  // Let the first store finish hydrating inside act, so the commits it causes
  // are not attributed to whichever later step happens to be running.
  await waitUntil(
    () => app.text().includes(en["ob.welcome"]),
    "the signed-in account's own surface",
    () => `text=${JSON.stringify(app.text())}`,
  );
  return app;
}

/** Mounts with no session and waits for the gate or a blocking recovery. */
async function startSignedOut(): Promise<Mounted> {
  client.setSession(null);
  const app = await mountEntry();
  await waitUntil(
    () =>
      app.text().includes(en["auth.welcomeBlurb"]) ||
      app.text().includes(en["auth.teardownTitle"]),
    "the signed-out gate or its recovery surface",
    () => `text=${JSON.stringify(app.text())}`,
  );
  return app;
}

/** Lets mount-time effects (store hydration, plan reconciliation) settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await delay(60);
  });
}

/**
 * Simulates a page reload or process restart: the tab's React tree, auth store
 * and transition coordinator are discarded, while the device keeps its marker,
 * its Supabase session and its native reminder state. A store left open by a
 * teardown that never finished is closed, as the process exit would.
 */
async function restart(): Promise<void> {
  while (mounted.length > 0) {
    const app = mounted.pop();
    if (app) await app.unmount();
  }
  const store = getAccountTransitionCoordinator().currentStore();
  if (store && !store.closed) await store.close();
  resetAuthForTesting();
  resetAccountTransitionForTesting();
  resetReminderSchedulingForTesting();
  resetIdentityChannelForTesting();
  setReminderAdapterForTesting(adapter);
  setLockManager(locks);
}

/** Writes an `active` marker for `userId`, as a previous launch would leave it. */
async function seedActiveOwner(userId: string): Promise<void> {
  const hash = await reminderOwnerHash(userId);
  completeReminderTransition(beginReminderTransition(hash));
}

function markerRaw(): string {
  return device.get(OWNER_MARKER_KEY) ?? "";
}

test("a session expiry closes the previous store and reaches the gate", async () => {
  const app = await startSignedIn(A_ID);
  const coordinator = getAccountTransitionCoordinator();
  const storeA = coordinator.currentStore();
  assert.ok(storeA, "the account store is registered with the coordinator");
  assert.equal(storeA.closed, false);
  const cancelsBefore = adapter.cancels;

  act(() => {
    client.emit("SIGNED_OUT", null);
  });
  await waitUntil(
    () => storeA.closed && app.text().includes(en["auth.welcomeBlurb"]),
    "the expired account to be torn down and the gate to render",
  );

  assert.equal(storeA.closed, true, "expiry closes the account's store");
  assert.ok(adapter.cancels > cancelsBefore, "expiry cancels scheduled reminders");
  assert.equal(app.text().includes(en["ob.welcome"]), false, "no signed-in surface remains");
  assert.equal(app.text().includes(en["auth.welcomeBlurb"]), true, "the sign-in gate is shown");

});

test("a failed expiry cancellation blocks another account until retry succeeds", async () => {
  const app = await startSignedIn(C_ID);
  const coordinator = getAccountTransitionCoordinator();
  const storeC = coordinator.currentStore();
  assert.ok(storeC);
  await storeC.putThing(makeThing({ id: "c-secret", name: "C private bill" }));

  adapter.failing = true;
  act(() => {
    client.emit("SIGNED_OUT", null);
  });
  await waitUntil(
    () => app.text().includes(en["auth.teardownTitle"]),
    "the identity-recovery surface",
    () => `text=${JSON.stringify(app.text())}`,
  );

  assert.equal(storeC.closed, false, "a failed cancellation leaves the store untouched");
  assert.equal(app.text().includes(en["auth.teardownBody"]), true);

  // A session for D arriving repeatedly must not be published over C.
  const sessionD = sessionFor(D_ID, "d@example.com");
  act(() => {
    client.emit("SIGNED_IN", sessionD);
    client.emit("SIGNED_IN", sessionD);
    client.emit("SIGNED_IN", sessionD);
  });
  await act(async () => {
    await delay(40);
  });
  assert.equal(coordinator.currentUserId(), C_ID, "D never activates while recovery is pending");
  assert.equal(app.text().includes(en["auth.teardownTitle"]), true);
  assert.equal(app.text().includes(en["ob.welcome"]), false);
  assert.equal(storeC.closed, false);

  adapter.failing = false;
  const retry = app.container.querySelector("button");
  assert.ok(retry, "the recovery surface offers a retry");
  act(() => {
    (retry as unknown as HTMLElement).click();
  });
  await waitUntil(
    () =>
      coordinator.currentUserId() === D_ID &&
      app.text().includes(en["ob.welcome"]),
    "D to activate and render its own surface after the retry",
    () => `user=${coordinator.currentUserId()} text=${JSON.stringify(app.text())}`,
  );

  assert.equal(storeC.closed, true, "the retried teardown closes C's store");
  assert.equal(adapter.ops.filter((op) => op === "cancel").length >= 2, true);
  const storeD = coordinator.currentStore();
  assert.ok(storeD, "D's store is registered after activation");
  assert.equal(storeD.scope.kind, "user");
  assert.deepEqual(await storeD.getAllThings(), [], "D sees none of C's records");
  assert.equal(app.text().includes(en["ob.welcome"]), true, "D reaches its own surface");

});

test("a session announced during teardown waits, and duplicate events do not tear down twice", async () => {
  const app = await startSignedIn(E_ID);
  const coordinator = getAccountTransitionCoordinator();
  const storeE = coordinator.currentStore();
  assert.ok(storeE);
  const cancelsBefore = adapter.cancels;
  const locksBefore = locks.counter.requests;

  adapter.holdNextCancel();
  act(() => {
    client.emit("SIGNED_OUT", null);
  });
  await waitUntil(() => adapter.blocked(), "the teardown cancellation to start");

  // Duplicate announcements of the next account while the teardown is still in
  // flight. None may be published, and none may start a second teardown.
  const sessionF = sessionFor(F_ID, "f@example.com");
  act(() => {
    client.emit("SIGNED_IN", sessionF);
    client.emit("SIGNED_IN", sessionF);
    client.emit("TOKEN_REFRESHED", sessionF);
  });
  await act(async () => {
    await delay(40);
  });

  assert.equal(coordinator.currentUserId(), E_ID, "the new session is still queued");
  assert.equal(storeE.closed, false);
  assert.equal(adapter.cancels - cancelsBefore, 1, "teardown ran once");
  assert.equal(locks.counter.requests - locksBefore, 1, "one identity lock acquisition");

  act(() => {
    adapter.releaseCancel();
  });
  await waitUntil(
    () =>
      coordinator.currentUserId() === F_ID &&
      app.text().includes(en["ob.welcome"]),
    "the queued session to activate and render after teardown",
    () => `user=${coordinator.currentUserId()} text=${JSON.stringify(app.text())}`,
  );

  assert.equal(storeE.closed, true, "the outgoing store is closed before F activates");
  // Three acquisitions: E's teardown, the ownership barrier that cancels before
  // F may be published, and F's own reconciliation through the coordinator.
  // Duplicate events add none. The signed-out and signed-in mounts both
  // reconcile their plans, so the adapter's total cancel count is not a dedupe
  // signal; the lock count is.
  await settle();
  assert.equal(
    locks.counter.requests - locksBefore,
    3,
    "duplicate events did not tear down again and F passed one ownership barrier",
  );
  const storeF = coordinator.currentStore();
  assert.ok(storeF);
  assert.deepEqual(await storeF.getAllThings(), []);

});

test("a session for another account adopted from shared storage tears the old one down first", async () => {
  const app = await startSignedIn(G_ID);
  const coordinator = getAccountTransitionCoordinator();
  const storeG = coordinator.currentStore();
  assert.ok(storeG);
  await storeG.putThing(makeThing({ id: "g-only", name: "Only G's record" }));
  const cancelsBefore = adapter.cancels;

  // Supabase publishes a session it read from shared storage when another tab
  // signs in. This tab has not signed out explicitly; the switch arrives only
  // as a new session.
  act(() => {
    client.emit("SIGNED_IN", sessionFor(H_ID, "h@example.com"));
  });
  await waitUntil(
    () =>
      coordinator.currentUserId() === H_ID &&
      app.text().includes(en["ob.welcome"]),
    "the adopted account to activate and render",
    () => `user=${coordinator.currentUserId()} text=${JSON.stringify(app.text())}`,
  );

  assert.equal(storeG.closed, true, "the outgoing account is torn down first");
  assert.ok(adapter.cancels > cancelsBefore, "its reminders are cancelled");
  const storeH = coordinator.currentStore();
  assert.ok(storeH);
  assert.notEqual(storeH, storeG);
  assert.deepEqual(
    (await storeH.getAllThings()).map((thing) => thing.id),
    [],
    "the adopted account never sees the previous account's records",
  );

});

// ---------------------------------------------------------------------------
// B2.2 cold-start and reload recovery
// ---------------------------------------------------------------------------

test("cold start cancels a previous account's reminders before the new account activates", async () => {
  await seedActiveOwner(A_ID);

  const seenAtCancel: Array<string | null> = [];
  adapter.onCancel = () =>
    seenAtCancel.push(getAccountTransitionCoordinator().currentUserId());

  const app = await startSignedIn(B_ID);

  assert.ok(
    seenAtCancel.includes(null),
    "a cancellation ran before any account was published",
  );
  assert.equal(
    getAccountTransitionCoordinator().currentUserId(),
    B_ID,
    "B is published only after the barrier",
  );
  assert.equal(readReminderMarker()?.phase, "active");
  assert.equal(
    readReminderMarker()?.owner,
    await reminderOwnerHash(B_ID),
    "the marker now names B, not A",
  );

  const raw = markerRaw();
  assert.equal(raw.includes(A_ID), false, "the marker carries no account id");
  assert.equal(raw.includes(B_ID), false, "the marker carries no account id");
  assert.equal(raw.includes("example.com"), false, "the marker carries no address");
  assert.equal(raw.includes("access-token"), false, "the marker carries no session");
  assert.equal(app.text().includes(en["ob.welcome"]), true);
});

test("a reload during an unfinished teardown recovers before the gate opens", async () => {
  await startSignedIn(A_ID);
  assert.equal(readReminderMarker()?.owner, await reminderOwnerHash(A_ID));
  const cancelsBefore = adapter.cancels;

  adapter.holdNextCancel();
  act(() => {
    client.emit("SIGNED_OUT", null);
  });
  await waitUntil(() => adapter.blocked(), "the teardown cancellation to start");
  assert.equal(
    readReminderMarker()?.phase,
    "transitioning",
    "the unfinished transition is persisted before the native call",
  );

  // Reload while the native cancel is still in flight. The old tab is gone;
  // the device keeps the marker and whatever the plugin still holds.
  await restart();
  const reloaded = await startSignedOut();

  assert.equal(
    reloaded.text().includes(en["auth.welcomeBlurb"]),
    true,
    "recovery reaches the gate",
  );
  assert.ok(
    adapter.cancels > cancelsBefore,
    "the reloaded app cancelled what was left",
  );
  assert.equal(readReminderMarker()?.phase, "active");
  assert.equal(readReminderMarker()?.owner, null);
  assert.equal(getAccountTransitionCoordinator().currentUserId(), null);
});

test("a restart after a failed cancellation stays blocked until recovery succeeds", async () => {
  await startSignedIn(A_ID);

  adapter.failing = true;
  act(() => {
    client.emit("SIGNED_OUT", null);
  });
  await waitUntil(
    () => readReminderMarker()?.phase === "transitioning",
    "the failed teardown to persist its unfinished marker",
  );

  await restart();
  const app = await startSignedOut();
  assert.equal(
    app.text().includes(en["auth.teardownTitle"]),
    true,
    "the restarted app is still blocked",
  );
  assert.equal(app.text().includes(en["auth.welcomeBlurb"]), false);
  assert.equal(
    readReminderMarker()?.phase,
    "transitioning",
    "the failure survives the restart",
  );
  assert.equal(getAccountTransitionCoordinator().currentUserId(), null);

  adapter.failing = false;
  const retry = app.container.querySelector("button");
  assert.ok(retry, "the blocked surface offers a retry");
  act(() => {
    (retry as unknown as HTMLElement).click();
  });
  await waitUntil(
    () => app.text().includes(en["auth.welcomeBlurb"]),
    "the gate after recovery",
    () => `text=${JSON.stringify(app.text())}`,
  );
  assert.equal(readReminderMarker()?.phase, "active");
  assert.equal(readReminderMarker()?.owner, null);
});

test("a new account cannot activate during recovery, then activates after a successful retry", async () => {
  await seedActiveOwner(A_ID);
  adapter.failing = true;
  const app = await startSignedOut();
  assert.equal(app.text().includes(en["auth.teardownTitle"]), true);

  await settle();
  const cancelsWhileBlocked = adapter.cancels;

  // Supabase already holds B's session, but the device cannot prove its
  // reminders are clean, so B must stay queued.
  const sessionB = sessionFor(B_ID, "b@example.com");
  act(() => {
    client.emit("SIGNED_IN", sessionB);
    client.emit("SIGNED_IN", sessionB);
    client.emit("TOKEN_REFRESHED", sessionB);
  });
  await act(async () => {
    await delay(40);
  });
  assert.equal(
    getAccountTransitionCoordinator().currentUserId(),
    null,
    "B is not published during recovery",
  );
  assert.equal(app.text().includes(en["ob.welcome"]), false);
  assert.equal(
    adapter.cancels,
    cancelsWhileBlocked,
    "duplicate announcements do not retry the failing plugin",
  );

  adapter.failing = false;
  const retry = app.container.querySelector("button");
  assert.ok(retry);
  act(() => {
    (retry as unknown as HTMLElement).click();
  });
  await waitUntil(
    () =>
      getAccountTransitionCoordinator().currentUserId() === B_ID &&
      app.text().includes(en["ob.welcome"]),
    "B to activate only after recovery",
    () =>
      `user=${getAccountTransitionCoordinator().currentUserId()} text=${JSON.stringify(app.text())}`,
  );
  assert.equal(
    readReminderMarker()?.owner,
    await reminderOwnerHash(B_ID),
    "B owns the reminders once it is published",
  );
});

test("failure to acquire the coordination lock blocks recovery until it can be retried", async () => {
  await seedActiveOwner(A_ID);
  const failingLocks = {
    calls: 0,
    request: async () => {
      failingLocks.calls += 1;
      throw new DOMException("The operation was aborted.", "AbortError");
    },
  };
  setLockManager(failingLocks);

  const app = await startSignedOut();

  assert.equal(failingLocks.calls, 1, "recovery asked for the identity lock");
  assert.equal(
    app.text().includes(en["auth.teardownTitle"]),
    true,
    "no activation without the lock",
  );
  assert.equal(app.text().includes(en["auth.welcomeBlurb"]), false);
  assert.equal(
    readReminderMarker()?.phase,
    "active",
    "a transition that never ran leaves the marker untouched",
  );
  assert.equal(readReminderMarker()?.owner, await reminderOwnerHash(A_ID));
  assert.equal(getAccountTransitionCoordinator().currentUserId(), null);

  setLockManager(locks);
  const retry = app.container.querySelector("button");
  assert.ok(retry);
  act(() => {
    (retry as unknown as HTMLElement).click();
  });
  await waitUntil(
    () => app.text().includes(en["auth.welcomeBlurb"]),
    "the gate once the lock is available",
    () => `text=${JSON.stringify(app.text())}`,
  );
  assert.equal(readReminderMarker()?.phase, "active");
  assert.equal(readReminderMarker()?.owner, null);
});

test("a corrupt marker is not trusted: cold start cancels before the gate opens", async () => {
  device.set(OWNER_MARKER_KEY, "{broken");
  const cancelsBefore = adapter.cancels;

  const app = await startSignedOut();

  assert.equal(app.text().includes(en["auth.welcomeBlurb"]), true);
  assert.ok(
    adapter.cancels > cancelsBefore,
    "an unproven reminder state is cancelled rather than assumed clean",
  );
  assert.equal(readReminderMarker()?.phase, "active");
  assert.equal(readReminderMarker()?.owner, null);
});

test("a token refresh for the published account neither cancels nor rewrites ownership", async () => {
  const app = await startSignedIn(A_ID);
  await settle();
  const markerBefore = readReminderMarker();
  const cancelsBefore = adapter.cancels;

  act(() => {
    client.emit("TOKEN_REFRESHED", sessionFor(A_ID, "a@example.com"));
  });
  await act(async () => {
    await delay(60);
  });

  assert.equal(
    adapter.cancels,
    cancelsBefore,
    "a same-account refresh must not wipe the scheduled plan",
  );
  assert.equal(
    readReminderMarker()?.tid,
    markerBefore?.tid,
    "ownership was not rewritten",
  );
  assert.equal(readReminderMarker()?.epoch, markerBefore?.epoch);
  assert.equal(getAccountTransitionCoordinator().currentUserId(), A_ID);
  assert.equal(app.text().includes(en["ob.welcome"]), true);
});

test("repeated retries share one attempt and duplicate events add none", async () => {
  await seedActiveOwner(A_ID);
  adapter.failing = true;
  const app = await startSignedOut();
  assert.equal(app.text().includes(en["auth.teardownTitle"]), true);
  await settle();

  const before = adapter.cancels;

  act(() => {
    client.emit("SIGNED_OUT", null);
    client.emit("SIGNED_OUT", null);
  });
  await act(async () => {
    await delay(40);
  });
  assert.equal(
    adapter.cancels,
    before,
    "duplicate sign-out events do not retry the failing plugin",
  );

  adapter.failing = false;
  adapter.holdNextCancel();
  const retry = app.container.querySelector("button");
  assert.ok(retry);
  const locksBeforeRetry = locks.counter.requests;
  act(() => {
    (retry as unknown as HTMLElement).click();
  });
  await waitUntil(() => adapter.blocked(), "the retry cancellation to start");
  assert.equal(
    locks.counter.requests - locksBeforeRetry,
    1,
    "the retry took the identity lock once",
  );

  act(() => {
    (retry as unknown as HTMLElement).click();
  });
  await act(async () => {
    await delay(40);
  });
  assert.equal(
    locks.counter.requests - locksBeforeRetry,
    1,
    "a second click shares the attempt already in flight",
  );
  assert.equal(
    adapter.cancels,
    before + 1,
    "the shared attempt cancelled once",
  );

  act(() => {
    adapter.releaseCancel();
  });
  await waitUntil(
    () => app.text().includes(en["auth.welcomeBlurb"]),
    "the gate after the shared retry",
    () => `text=${JSON.stringify(app.text())}`,
  );
  assert.equal(
    locks.counter.requests - locksBeforeRetry,
    1,
    "success is not retried again",
  );
  assert.equal(readReminderMarker()?.phase, "active");
  assert.equal(readReminderMarker()?.owner, null);
});

// ---------------------------------------------------------------------------
// B2.2 unavailable authentication on a cold start (ADR 0002 §5.3)
// ---------------------------------------------------------------------------

test("a session retrieval timeout on a cold start blocks the app and still cancels reminders", async () => {
  await seedActiveOwner(A_ID);
  const cancelsBefore = adapter.cancels;
  setSessionTimeoutForTesting(30);

  try {
    client.auth.getSession = () => new Promise<never>(() => {});
    const app = await mountEntry();

    await waitUntil(
      () =>
        app.text().includes(en["auth.sessionErrorTitle"]) &&
        readReminderMarker()?.phase === "active" &&
        readReminderMarker()?.owner === null,
      "the fail-closed surface and the unresolved cancellation",
      () =>
        `marker=${markerRaw()} cancels=${adapter.cancels} text=${JSON.stringify(app.text())}`,
    );

    assert.ok(
      adapter.cancels > cancelsBefore,
      "the timed-out read still cancelled the previous owner's reminders",
    );
    assert.equal(getAccountTransitionCoordinator().currentUserId(), null);
    assert.equal(app.text().includes(en["auth.welcomeBlurb"]), false);
    assert.equal(app.text().includes(en["ob.welcome"]), false);
  } finally {
    setSessionTimeoutForTesting(null);
  }
});

test("a Supabase session retrieval error blocks a cold start and cancels reminders", async () => {
  await seedActiveOwner(A_ID);
  const cancelsBefore = adapter.cancels;

  client.auth.getSession = async () => {
    throw new Error("storage unavailable");
  };
  const app = await mountEntry();

  await waitUntil(
    () =>
      app.text().includes(en["auth.sessionErrorTitle"]) &&
      readReminderMarker()?.phase === "active" &&
      readReminderMarker()?.owner === null,
    "the fail-closed surface and the completed cancellation",
    () => `marker=${markerRaw()} text=${JSON.stringify(app.text())}`,
  );

  assert.ok(adapter.cancels > cancelsBefore);
  assert.equal(getAccountTransitionCoordinator().currentUserId(), null);
  assert.equal(app.text().includes(en["ob.welcome"]), false);
});

test("an unavailable session authority still cancels the previous owner's reminders", async () => {
  await seedActiveOwner(A_ID);
  const cancelsBefore = adapter.cancels;

  client.auth.getSession = (async () => ({
    data: { session: null },
    error: { message: "auth storage unavailable" },
  })) as unknown as FakeClient["auth"]["getSession"];
  const app = await mountEntry();

  await waitUntil(
    () =>
      readReminderMarker()?.phase === "active" &&
      readReminderMarker()?.owner === null,
    "the previous owner's reminders to be cancelled",
    () => `marker=${markerRaw()} text=${JSON.stringify(app.text())}`,
  );

  assert.ok(adapter.cancels > cancelsBefore);
  assert.equal(
    app.text().includes(en["auth.sessionErrorTitle"]),
    true,
    "an auth error is not evidence of being signed out",
  );
  assert.equal(getAccountTransitionCoordinator().currentUserId(), null);
});

test("cancellation during an unresolved cold start does not need the previous account id", async () => {
  await seedActiveOwner(A_ID);
  const seenAtCancel: Array<string | null> = [];
  adapter.onCancel = () =>
    seenAtCancel.push(getAccountTransitionCoordinator().currentUserId());

  client.auth.getSession = async () => {
    throw new Error("storage unavailable");
  };
  await mountEntry();

  await waitUntil(
    () =>
      readReminderMarker()?.phase === "active" &&
      readReminderMarker()?.owner === null,
    "the unconditional cancellation",
  );

  assert.ok(seenAtCancel.length > 0, "the plugin was asked to cancel");
  assert.deepEqual(
    [...new Set(seenAtCancel)],
    [null],
    "no account was published while the cancellation ran",
  );
});

test("a failed cancellation during an unresolved cold start keeps the app blocked", async () => {
  adapter.failing = true;
  client.auth.getSession = async () => {
    throw new Error("storage unavailable");
  };
  const app = await mountEntry();

  await waitUntil(
    () =>
      app.text().includes(en["auth.sessionErrorTitle"]) &&
      readReminderMarker()?.phase === "transitioning",
    "the failed transition to persist while the app stays blocked",
    () => `marker=${markerRaw()} text=${JSON.stringify(app.text())}`,
  );
  await settle();

  assert.equal(
    readReminderMarker()?.phase,
    "transitioning",
    "an uncompleted cancellation is not recorded as clean",
  );
  assert.equal(getAccountTransitionCoordinator().currentUserId(), null);
  assert.equal(app.text().includes(en["auth.welcomeBlurb"]), false);
  assert.equal(app.text().includes(en["ob.welcome"]), false);
  assert.equal(app.text().includes(en["auth.sessionErrorTitle"]), true);
});

test("retry recovers once authentication and the reminder plugin are available again", async () => {
  adapter.failing = true;
  client.auth.getSession = async () => {
    throw new Error("storage unavailable");
  };
  const app = await mountEntry();

  await waitUntil(
    () =>
      app.text().includes(en["auth.sessionErrorTitle"]) &&
      readReminderMarker()?.phase === "transitioning",
    "the blocked cold start",
  );
  await settle();

  adapter.failing = false;
  client.auth.getSession = async () => ({
    data: { session: sessionFor(A_ID, "a@example.com") },
    error: null,
  });

  const retry = app.container.querySelector("button");
  assert.ok(retry, "the blocked surface offers a retry");
  act(() => {
    (retry as unknown as HTMLElement).click();
  });

  await waitUntil(
    () =>
      getAccountTransitionCoordinator().currentUserId() === A_ID &&
      app.text().includes(en["ob.welcome"]),
    "the recovered session to activate",
    () =>
      `user=${getAccountTransitionCoordinator().currentUserId()} marker=${markerRaw()} text=${JSON.stringify(app.text())}`,
  );

  assert.equal(readReminderMarker()?.phase, "active");
  assert.equal(
    readReminderMarker()?.owner,
    await reminderOwnerHash(A_ID),
    "the recovered account owns the reminders it schedules",
  );
});

// ---------------------------------------------------------------------------
// Cross-tab transport unavailable (ADR 0002 §5.3, fail closed)
// ---------------------------------------------------------------------------

test("a browser with no cross-tab transport never opens an account", async () => {
  setIdentityTransportForTesting({ broadcast: false, storage: false });
  client.setSession(sessionFor(A_ID, "a@example.com"));

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["auth.sessionErrorTitle"]),
    "the unsupported-browser surface",
    () => `text=${JSON.stringify(app.text())}`,
  );

  assert.equal(
    app.text().includes(
      "cannot coordinate account changes between tabs",
    ),
    true,
    "the failure names the missing capability",
  );
  assert.equal(
    getAccountTransitionCoordinator().currentUserId(),
    null,
    "no account is published without a way to announce it to other tabs",
  );
  assert.equal(
    app.text().includes(en["ob.welcome"]),
    false,
    "no signed-in surface is reachable",
  );
  assert.deepEqual(adapter.ops, [], "nothing is scheduled for an unopened account");
});

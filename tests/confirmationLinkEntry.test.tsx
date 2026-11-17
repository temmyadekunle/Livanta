/**
 * A confirmation link is the account's own proof of identity.
 *
 * The introduction and the "Continue as" choice exist so that a *restored*
 * session cannot open an account the person in front of the device has not
 * chosen. A session exchanged from this launch's sign-up link is different:
 * the link itself proves the account, so asking again would put two screens
 * between a confirmed user and their desk.
 *
 * These tests drive the real AppEntry and auth store with a fake Supabase
 * client. The three launch variants (same browser, new tab, fresh browser)
 * differ only in what the device already holds, which is exactly what the
 * fixtures seed. Nothing here trusts the URL on its own: every success case
 * also publishes a session whose access token is the one the fragment carried.
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
const { resetEntryGateForTesting } = await import("../lib/entryGate.ts");
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
type ReminderNativeAdapter = import("../lib/schedule.ts").ReminderNativeAdapter;
const {
  beginReminderTransition,
  completeReminderTransition,
  reminderOwnerHash,
  setReminderOwnerStorageForTesting,
} = await import("../lib/reminders/ownerMarker.ts");
const { createLocalStore, userScope } = await import("../lib/db.ts");
const {
  DEFAULT_SETTINGS,
  saveSettings,
} = await import("../lib/settings.ts");

type Session = import("@supabase/supabase-js").Session;
type Root = import("react-dom/client").Root;

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const A_ACCOUNT = {
  id: A_ID,
  email: "confirmed@example.com",
  password: "confirmed-password",
};
const B_ACCOUNT = {
  id: B_ID,
  email: "other@example.com",
  password: "other-password",
};

function sessionFor(id: string, email: string, accessToken: string): Session {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
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

function fakeClient(session: Session | null) {
  let current = session;
  let listener: ((event: AuthEvent, session: Session | null) => void) | null =
    null;
  return {
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      onAuthStateChange: (callback: (event: AuthEvent, session: Session | null) => void) => {
        listener = callback;
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
      signInWithPassword: async () => ({
        data: {},
        error: { message: "Invalid login credentials" },
      }),
      signUp: async () => ({
        data: { session: null, user: null },
        error: null,
      }),
      resetPasswordForEmail: async () => ({ error: null }),
      resend: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      signInWithOAuth: async () => ({ error: null }),
    },
    emit(event: AuthEvent, next: Session | null) {
      current = next;
      listener?.(event, next);
    },
  };
}

interface ScheduledNotification {
  readonly id: number;
  readonly title: string;
  readonly fireAt: number;
}

interface RecordingAdapter extends ReminderNativeAdapter {
  /** What the operating system still holds; cancelAll clears it. */
  pending: ScheduledNotification[];
  cancels: number;
  schedules: ScheduledNotification[][];
}

function recordingAdapter(): RecordingAdapter {
  const adapter: RecordingAdapter = {
    pending: [],
    cancels: 0,
    schedules: [],
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    cancelAll: async () => {
      adapter.cancels += 1;
      adapter.pending = [];
    },
    schedule: async (options) => {
      const batch = options.notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        fireAt: new Date(notification.schedule.at).getTime(),
      }));
      adapter.schedules.push(batch);
      adapter.pending.push(...batch);
    },
  };
  return adapter;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitUntil(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await act(async () => {
      await delay(5);
    });
  }
  throw new Error(`Timed out waiting for ${label}`);
}

interface Mounted {
  container: Element;
  text: () => string;
  unmount: () => Promise<void>;
}

const mounted: Mounted[] = [];

async function mountEntry(): Promise<Mounted> {
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root: Root = createRoot(container as unknown as Element);
  const app: Mounted = {
    container: container as unknown as Element,
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

/** Unmounts the newest root without the per-test cleanup, for a reload. */
async function unload(app: Mounted): Promise<void> {
  mounted.pop();
  await app.unmount();
  const store = getAccountTransitionCoordinator().currentStore();
  if (store && !store.closed) await store.close();
  resetAuthForTesting();
  resetAccountTransitionForTesting();
  resetIdentityChannelForTesting();
  resetReminderSchedulingForTesting();
  setReminderAdapterForTesting(adapter);
  setLockManager(workingLocks());
  resetEntryGateForTesting();
}

function buttonNamed(app: Mounted, label: string): HTMLElement {
  const found = [...app.container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  assert.ok(
    found,
    `a "${label}" button is available; text=${JSON.stringify(app.text())}`,
  );
  return found as unknown as HTMLElement;
}

async function click(app: Mounted, label: string): Promise<void> {
  await act(async () => {
    buttonNamed(app, label).click();
    await delay(10);
  });
}

async function walkIntroduction(app: Mounted): Promise<void> {
  await waitUntil(
    () => app.text().includes(en["intro.welcomeBody"]),
    "the introduction's first slide",
  );
  await click(app, en["intro.continue"]);
  await waitUntil(
    () => app.text().includes(en["intro.organisedBody"]),
    "the second slide",
  );
  await click(app, en["intro.continue"]);
  await waitUntil(
    () => app.text().includes(en["intro.controlBody"]),
    "the third slide",
  );
  await click(app, en["intro.getStarted"]);
}

function dueSoon(days = 10): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seedAccount(id: string, name: string): Promise<void> {
  const store = createLocalStore(userScope(id));
  await saveSettings(store, {
    ...DEFAULT_SETTINGS,
    onboarded: true,
    locale: "en",
    notifyUrgent: true,
    leadDays: [7],
  });
  await store.putThing(
    makeThing({ id: `${id}-thing`, name, dueDate: dueSoon() }),
  );
  await store.close();
}

/** Writes the marker a completed launch leaves for its reminder owner. */
async function seedOwner(id: string): Promise<void> {
  completeReminderTransition(beginReminderTransition(await reminderOwnerHash(id)));
}

/** The fragment Supabase appends for an implicit-grant sign-up link. */
function confirmationHash(token: string): string {
  return [
    "#access_token=" + encodeURIComponent(token),
    "refresh_token=" + encodeURIComponent(`refresh-${token}`),
    "expires_in=3600",
    "expires_at=1800000000",
    "token_type=bearer",
    "type=signup",
  ].join("&");
}

function setHash(hash: string): void {
  win.history.replaceState(null, "", hash ? `/${hash}` : "/");
}

function isOnDesk(app: Mounted): boolean {
  return app.text().includes(en["ui.skipToContent"]);
}

let adapter: RecordingAdapter;
let device: Map<string, string>;

const workingLocks = () => ({
  request: async (
    _name: string,
    _options: { signal: AbortSignal },
    callback: () => Promise<void>,
  ) => {
    await callback();
  },
});

test.beforeEach(async () => {
  resetAuthForTesting();
  resetAccountTransitionForTesting();
  resetReminderSchedulingForTesting();
  resetIdentityChannelForTesting();
  setIdentityTransportForTesting(null);
  setSupabaseForTesting(null);
  resetEntryGateForTesting();
  setHash("");
  win.localStorage.removeItem("livanta.entry.locale.v1");
  win.localStorage.removeItem("livanta.auth.pendingConfirmation.v1");
  win.localStorage.removeItem("livanta.auth.pendingEmail.v1");

  device = new Map();
  setReminderOwnerStorageForTesting({
    getItem: (key) => device.get(key) ?? null,
    setItem: (key, value) => {
      device.set(key, value);
    },
  });
  adapter = recordingAdapter();
  setReminderAdapterForTesting(adapter);
  setLockManager(workingLocks());
});

test.afterEach(async () => {
  while (mounted.length > 0) {
    const app = mounted.pop();
    if (app) await app.unmount();
  }
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

test("a confirmation in the launch that created the account opens the desk", async () => {
  await seedAccount(A_ID, "A private bill");
  // The registration that sent the email: signed out, a pending confirmation
  // marker in device storage, and the introduction in front of the user.
  win.localStorage.setItem("livanta.auth.pendingConfirmation.v1", "1");
  win.localStorage.setItem("livanta.auth.pendingEmail.v1", A_ACCOUNT.email);
  setSupabaseForTesting(
    fakeClient(null) as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const registering = await mountEntry();
  await waitUntil(
    () => registering.text().includes(en["intro.welcomeBody"]),
    "the introduction while awaiting confirmation",
  );

  // The link navigates the same browser: device storage survives, the document
  // and its launch state do not.
  await unload(registering);
  const token = "link-token-same-launch";
  setHash(confirmationHash(token));
  const client = fakeClient(sessionFor(A_ID, A_ACCOUNT.email, token));
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(() => isOnDesk(app), "the confirmed account's desk");
  assert.equal(
    app.text().includes(en["intro.welcomeBody"]),
    false,
    "the introduction is not shown again",
  );
  assert.equal(
    app.text().includes(en["auth.welcomeBlurb"]),
    false,
    "no welcome or Continue as choice is shown",
  );
  assert.equal(
    app.text().includes("A private bill"),
    true,
    "the confirmed account's own record is on the desk",
  );
  // The pending-confirmation marker is a signed-out state; it cannot survive
  // the session that confirms it.
  assert.equal(
    win.localStorage.getItem("livanta.auth.pendingConfirmation.v1"),
    null,
    "the pending confirmation marker is cleared",
  );
});

test("a confirmation opened in a new tab opens the desk", async () => {
  await seedAccount(A_ID, "A private bill");
  // A new tab shares the pending confirmation the first tab recorded.
  win.localStorage.setItem("livanta.auth.pendingConfirmation.v1", "1");
  win.localStorage.setItem("livanta.auth.pendingEmail.v1", A_ACCOUNT.email);
  const token = "link-token-new-tab";
  setHash(confirmationHash(token));
  setSupabaseForTesting(
    fakeClient(
      sessionFor(A_ID, A_ACCOUNT.email, token),
    ) as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(() => isOnDesk(app), "the new tab's desk");
  assert.equal(
    app.text().includes(en["intro.welcomeBody"]),
    false,
    "a new tab does not replay the introduction",
  );
  assert.equal(
    app.text().includes(`Continue as ${A_ACCOUNT.email}`),
    false,
    "a new tab does not ask again which account this is",
  );
});

test("a confirmation after a fresh browser launch keeps the armed plan", async () => {
  await seedAccount(A_ID, "A private bill");
  await seedOwner(A_ID);
  adapter.pending = [
    {
      id: 1,
      title: "A private bill is due in 7 days",
      fireAt: Date.now() + 86_400_000,
    },
  ];
  const token = "link-token-fresh-launch";
  setHash(confirmationHash(token));
  setSupabaseForTesting(
    fakeClient(
      sessionFor(A_ID, A_ACCOUNT.email, token),
    ) as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => isOnDesk(app) && adapter.schedules.length === 1,
    "the relaunched desk and its reconciled plan",
  );

  assert.equal(
    app.text().includes(en["intro.welcomeBody"]),
    false,
    "a fresh launch with a confirmation link does not show the introduction",
  );
  assert.equal(
    app.text().includes(`Continue as ${A_ACCOUNT.email}`),
    false,
    "a fresh launch with a confirmation link does not ask for the choice",
  );
  // The link already passed the entry choice, so adoption at entry cancels
  // nothing. The single cancellation left is the ordinary reconciliation that
  // runs when the desk opens; a restored session would have two (entry, then
  // reconciliation).
  assert.ok(
    adapter.cancels < 2,
    `the entry barrier did not cancel the adopted plan (cancels=${adapter.cancels})`,
  );
  assert.equal(adapter.pending.length, 1, "the plan is still armed");
  assert.deepEqual(
    adapter.pending.map((notification) => notification.title),
    ["A private bill is due in 7 days"],
  );
});

test("a restored session without a link still sees the introduction and choice", async () => {
  await seedAccount(A_ID, "A private bill");
  setSupabaseForTesting(
    fakeClient(
      sessionFor(A_ID, A_ACCOUNT.email, "ordinary-session"),
    ) as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["intro.welcomeBody"]),
    "the introduction for a restored session",
  );
  await walkIntroduction(app);
  await waitUntil(
    () => app.text().includes(en["auth.welcomeBlurb"]),
    "the welcome for a restored session",
  );
  await click(app, en["auth.signInTitle"]);
  await waitUntil(
    () => app.text().includes(`Continue as ${A_ACCOUNT.email}`),
    "the explicit choice",
  );
  assert.equal(isOnDesk(app), false, "the desk is not open before the choice");
  assert.equal(
    app.text().includes("A private bill"),
    false,
    "the restored account's records wait behind the choice",
  );
});

test("a signed-out device without a link still sees the introduction and gate", async () => {
  setSupabaseForTesting(
    fakeClient(null) as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["intro.welcomeBody"]),
    "the introduction for a signed-out device",
  );
  await walkIntroduction(app);
  await waitUntil(
    () => app.text().includes(en["auth.welcomeBlurb"]),
    "the authentication gate",
  );
  assert.equal(isOnDesk(app), false, "no desk is reachable while signed out");
});

test("an expired confirmation link keeps both gates and explains why", async () => {
  setHash(
    "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  );
  setSupabaseForTesting(
    fakeClient(null) as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["intro.welcomeBody"]),
    "the introduction after a failed link",
  );
  await walkIntroduction(app);
  await waitUntil(
    () => app.text().includes(en["auth.confirmLinkExpiredBody"]),
    "the expired-link explanation",
  );
  assert.equal(isOnDesk(app), false, "a failed link opens nothing");
});

test("an invalid confirmation link keeps both gates and explains why", async () => {
  setHash("#error=access_denied&error_description=Email+link+is+invalid");
  setSupabaseForTesting(
    fakeClient(null) as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["intro.welcomeBody"]),
    "the introduction after an invalid link",
  );
  await walkIntroduction(app);
  await waitUntil(
    () => app.text().includes(en["auth.confirmLinkInvalidBody"]),
    "the invalid-link explanation",
  );
  assert.equal(isOnDesk(app), false, "an invalid link opens nothing");
});

test("a fragment whose session token differs proves nothing", async () => {
  await seedAccount(B_ID, "B private bill");
  setHash(confirmationHash("link-token-a"));
  // The session in hand belongs to another account, so the fragment's token
  // cannot be the one the client published.
  setSupabaseForTesting(
    fakeClient(
      sessionFor(B_ID, B_ACCOUNT.email, "session-token-b"),
    ) as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["intro.welcomeBody"]),
    "the introduction for an unproven fragment",
  );
  await walkIntroduction(app);
  await click(app, en["auth.signInTitle"]);
  await waitUntil(
    () => app.text().includes(`Continue as ${B_ACCOUNT.email}`),
    "the ordinary choice",
  );
  assert.equal(isOnDesk(app), false, "the fragment alone does not open a desk");
  assert.equal(
    app.text().includes("B private bill"),
    false,
    "no account's records are shown before the choice",
  );
});

test("A's confirmation replaces B's device without exposing B's records", async () => {
  await seedAccount(A_ID, "A private bill");
  await seedAccount(B_ID, "B private bill");
  await seedOwner(B_ID);
  adapter.pending = [
    {
      id: 2,
      title: "B private bill is due in 7 days",
      fireAt: Date.now() + 86_400_000,
    },
  ];
  const token = "link-token-a";
  setHash(confirmationHash(token));
  setSupabaseForTesting(
    fakeClient(
      sessionFor(A_ID, A_ACCOUNT.email, token),
    ) as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => isOnDesk(app) && adapter.schedules.length === 1,
    "A's desk after B's device",
  );

  assert.equal(
    app.text().includes("B private bill"),
    false,
    "B's record is never shown",
  );
  assert.equal(
    app.text().includes("A private bill"),
    true,
    "A's record is shown",
  );
  assert.deepEqual(
    adapter.pending.map((notification) => notification.title),
    ["A private bill is due in 7 days"],
    "only A's plan remains armed",
  );
  assert.ok(adapter.cancels >= 1, "B's plan was cancelled in the switch");
});

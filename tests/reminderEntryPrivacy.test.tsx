/**
 * Reminders must not outrun the entry choice.
 *
 * A restored Supabase session is adopted before the welcome screen, and the
 * desk behind that screen is already hydrated. These tests drive the real
 * AppEntry, auth store, reminder coordinator and native bridge with a recording
 * adapter, so they assert the device state rather than a React flag: a plan an
 * earlier launch left armed is cancelled before the choice, nothing is
 * scheduled or delivered on an auth surface, and the plan is reconciled once
 * when the chosen account's app surface is ready.
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
  loadSettings,
  saveSettings,
} = await import("../lib/settings.ts");

type Session = import("@supabase/supabase-js").Session;
type Root = import("react-dom/client").Root;

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const NEW_ID = "99999999-9999-4999-8999-999999999999";

const A_ACCOUNT = {
  id: A_ID,
  email: "previous@example.com",
  password: "previous-password",
};
const B_ACCOUNT = {
  id: B_ID,
  email: "other@example.com",
  password: "other-password",
};

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

interface Account {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

interface FakeClient {
  auth: {
    getSession: () => Promise<{ data: { session: Session | null }; error: null }>;
    onAuthStateChange: (
      callback: (event: AuthEvent, session: Session | null) => void,
    ) => { data: { subscription: { unsubscribe: () => void } } };
    signOut: () => Promise<{ error: null }>;
    signInWithPassword: (credentials: {
      email: string;
      password: string;
    }) => Promise<{ data: unknown; error: { message: string } | null }>;
    signUp: (credentials: {
      email: string;
      password: string;
    }) => Promise<{
      data: { session: Session | null; user: { id: string } | null };
      error: null;
    }>;
    resetPasswordForEmail: () => Promise<{ error: null }>;
    resend: () => Promise<{ error: null }>;
    updateUser: () => Promise<{ error: null }>;
    signInWithOAuth: () => Promise<{ error: null }>;
  };
  setSession: (session: Session | null) => void;
  emit: (event: AuthEvent, session: Session | null) => void;
}

function fakeClient(options: {
  session: Session | null;
  accounts: readonly Account[];
}): FakeClient {
  let current = options.session;
  let listener: ((event: AuthEvent, session: Session | null) => void) | null =
    null;
  const accounts = [...options.accounts];
  return {
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      onAuthStateChange: (callback) => {
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
      signInWithPassword: async ({ email, password }) => {
        const account = accounts.find(
          (candidate) =>
            candidate.email === email && candidate.password === password,
        );
        if (!account) {
          return { data: {}, error: { message: "Invalid login credentials" } };
        }
        const session = sessionFor(account.id, account.email);
        current = session;
        listener?.("SIGNED_IN", session);
        return { data: { session, user: session.user }, error: null };
      },
      signUp: async ({ email, password }) => {
        const account = { id: NEW_ID, email, password };
        accounts.push(account);
        const session = sessionFor(account.id, account.email);
        current = session;
        listener?.("SIGNED_IN", session);
        return { data: { session, user: { id: NEW_ID } }, error: null };
      },
      resetPasswordForEmail: async () => ({ error: null }),
      resend: async () => ({ error: null }),
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
  failCancel: boolean;
}

function recordingAdapter(): RecordingAdapter {
  const adapter: RecordingAdapter = {
    pending: [],
    cancels: 0,
    schedules: [],
    failCancel: false,
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    cancelAll: async () => {
      adapter.cancels += 1;
      if (adapter.failCancel) throw new Error("plugin refused");
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

function setInput(container: Element, selector: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(selector);
  assert.ok(input, `${selector} exists`);
  const setter = Object.getOwnPropertyDescriptor(
    win.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(
      new win.Event("input", { bubbles: true }) as unknown as Event,
    );
  });
}

async function submit(app: Mounted): Promise<void> {
  const form = app.container.querySelector("form");
  assert.ok(form, "the auth form exists");
  await act(async () => {
    form.dispatchEvent(
      new win.Event("submit", {
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    );
    await delay(10);
  });
}

/** Walks the three introduction slides without assuming what renders next. */
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

async function finishIntroduction(app: Mounted): Promise<void> {
  await walkIntroduction(app);
  await waitUntil(
    () => app.text().includes(en["auth.welcomeBlurb"]),
    "the authentication welcome",
  );
}

async function settle(ms = 120): Promise<void> {
  await act(async () => {
    await delay(ms);
  });
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

function titlesOf(batch: ScheduledNotification[] | undefined): string[] {
  return (batch ?? []).map((notification) => notification.title);
}

let client: FakeClient;
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

/** Stands in for a launch that already completed the introduction and choice. */
function passEntryFlow(): void {
  resetEntryGateForTesting({ introDone: true, choiceDone: true });
}

test.beforeEach(async () => {
  resetAuthForTesting();
  resetAccountTransitionForTesting();
  resetReminderSchedulingForTesting();
  resetIdentityChannelForTesting();
  setIdentityTransportForTesting(null);
  setSupabaseForTesting(null);
  resetEntryGateForTesting();
  win.localStorage.removeItem("livanta.entry.locale.v1");

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

test("a restored account's armed notifications are cancelled before the choice", async () => {
  await seedAccount(A_ID, "A private bill");
  await seedOwner(A_ID);
  adapter.pending = [
    {
      id: 1,
      title: "A private bill is due in 7 days",
      fireAt: Date.now() + 86_400_000,
    },
  ];
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => adapter.cancels >= 1 && adapter.pending.length === 0,
    "the restored plan to be cancelled at entry",
  );

  assert.equal(
    app.text().includes(en["intro.welcomeBody"]),
    true,
    "the launch still starts with the introduction",
  );
  assert.equal(adapter.schedules.length, 0, "nothing is rescheduled before the choice");
  assert.equal(
    app.text().includes("A private bill"),
    false,
    "the archived account's record is not rendered before the choice",
  );

  await finishIntroduction(app);
  assert.equal(
    app.text().includes(en["auth.welcomeBlurb"]),
    true,
    "the welcome is reached with the plan still suspended",
  );
  assert.equal(adapter.schedules.length, 0, "the welcome does not reschedule");
  assert.equal(adapter.pending.length, 0, "no notification is armed behind the welcome");

  // Scheduling information lives with the account records, which cancellation
  // never touches.
  const store = createLocalStore(userScope(A_ID));
  const settings = await loadSettings(store);
  assert.deepEqual(settings.leadDays, [7], "the lead days are preserved");
  assert.equal(settings.notifyUrgent, true, "the reminder preference is preserved");
  assert.deepEqual(
    (await store.getAllThings()).map((thing) => thing.name),
    ["A private bill"],
    "the account's record is preserved",
  );
  await store.close();
});

test("signing in and choosing the restored account schedules its plan exactly once", async () => {
  await seedAccount(A_ID, "A private bill");
  await seedOwner(A_ID);
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(() => adapter.cancels >= 1, "the entry cancellation");
  await finishIntroduction(app);
  await click(app, en["auth.signInTitle"]);
  const continueAs = `Continue as ${A_ACCOUNT.email}`;
  await waitUntil(() => app.text().includes(continueAs), "the explicit continue");
  await click(app, continueAs);
  await waitUntil(
    () => app.text().includes(en["ui.skipToContent"]),
    "the chosen account's app surface",
  );
  await waitUntil(() => adapter.schedules.length === 1, "one reconciled plan");

  const titles = titlesOf(adapter.schedules[0]);
  assert.deepEqual(
    titles,
    ["A private bill is due in 7 days"],
    "the chosen account's plan is scheduled after the choice",
  );
  assert.equal(
    titles.filter((title) => title.includes("A private bill")).length,
    1,
    "the reminder is not duplicated",
  );
  assert.equal(adapter.pending.length, 1, "the device holds the plan once");

  // A same-account token refresh republishes the session; it is not a new
  // owner and must not schedule the plan a second time.
  act(() => {
    client.emit("TOKEN_REFRESHED", sessionFor(A_ID, A_ACCOUNT.email));
  });
  await settle();
  assert.equal(adapter.schedules.length, 1, "resuming does not duplicate the plan");
  assert.equal(adapter.pending.length, 1, "the armed plan is unchanged");
});

test("creating a new account never schedules the restored account's plan", async () => {
  await seedAccount(A_ID, "A private bill");
  await seedOwner(A_ID);
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(() => adapter.cancels >= 1, "the entry cancellation");
  await finishIntroduction(app);
  await click(app, en["auth.signUpTitle"]);
  setInput(app.container, "#a-email", "new@example.com");
  setInput(app.container, "#a-password", "new-password");
  await submit(app);
  await waitUntil(
    () => app.text().includes(en["ob.welcome"]),
    "the new account's first-run setup",
  );
  await settle();

  assert.equal(
    adapter.schedules.some((batch) =>
      titlesOf(batch).some((title) => title.includes("A private bill")),
    ),
    false,
    "the previous account's reminders never reach the device",
  );
  assert.equal(adapter.pending.length, 0, "nothing is armed for the new account yet");
  assert.equal(
    app.text().includes("A private bill"),
    false,
    "the new account's surface shows no previous records",
  );
});

test("a sign-out cancels the account's plan and clears the device", async () => {
  await seedAccount(A_ID, "A private bill");
  await seedOwner(A_ID);
  passEntryFlow();
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["ui.skipToContent"]) && adapter.schedules.length === 1,
    "the signed-in plan",
  );
  assert.equal(adapter.pending.length, 1, "the plan is armed while signed in");
  const cancelsBefore = adapter.cancels;

  act(() => {
    client.emit("SIGNED_OUT", null);
  });
  await waitUntil(
    () =>
      adapter.cancels > cancelsBefore &&
      adapter.pending.length === 0 &&
      app.text().includes(en["auth.welcomeBlurb"]),
    "the sign-out to cancel the plan and reach the gate",
  );
  assert.equal(
    app.text().includes(en["ui.skipToContent"]),
    false,
    "the account surface is gone",
  );
  assert.equal(adapter.schedules.length, 1, "sign-out schedules nothing new");
});

test("switching accounts replaces A's notifications with B's", async () => {
  await seedAccount(A_ID, "A private bill");
  await seedAccount(B_ID, "B private bill");
  await seedOwner(A_ID);
  passEntryFlow();
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT, B_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["ui.skipToContent"]) && adapter.schedules.length === 1,
    "A's plan",
  );
  assert.deepEqual(titlesOf(adapter.schedules[0]), [
    "A private bill is due in 7 days",
  ]);

  act(() => {
    client.emit("SIGNED_OUT", null);
  });
  await waitUntil(
    () => app.text().includes(en["auth.welcomeBlurb"]),
    "the gate after sign-out",
  );

  await click(app, en["auth.signInTitle"]);
  setInput(app.container, "#a-email", B_ACCOUNT.email);
  setInput(app.container, "#a-password", B_ACCOUNT.password);
  await submit(app);
  await waitUntil(
    () =>
      app.text().includes(en["ui.skipToContent"]) && adapter.schedules.length === 2,
    "B's own plan",
  );

  const bTitles = titlesOf(adapter.schedules[1]);
  assert.deepEqual(bTitles, ["B private bill is due in 7 days"]);
  assert.equal(
    bTitles.some((title) => title.includes("A private bill")),
    false,
    "A's reminder cannot appear in B's session",
  );
  assert.deepEqual(
    adapter.pending.map((notification) => notification.title),
    ["B private bill is due in 7 days"],
    "the device holds only B's plan",
  );
});

test("a reload cancels the armed plan at entry and reconciles it once", async () => {
  await seedAccount(A_ID, "A private bill");
  await seedOwner(A_ID);
  passEntryFlow();
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const first = await mountEntry();
  await waitUntil(
    () => first.text().includes(en["ui.skipToContent"]) && adapter.schedules.length === 1,
    "the first launch's plan",
  );
  assert.equal(adapter.pending.length, 1);

  // A reload discards the React tree, auth store and coordinator; the device
  // keeps its marker, its session and the alarms the previous launch armed.
  mounted.pop();
  await first.unmount();
  const lingering = getAccountTransitionCoordinator().currentStore();
  if (lingering && !lingering.closed) await lingering.close();
  resetAuthForTesting();
  resetAccountTransitionForTesting();
  resetIdentityChannelForTesting();
  resetReminderSchedulingForTesting();
  setReminderAdapterForTesting(adapter);
  setLockManager(workingLocks());
  resetEntryGateForTesting();

  const second = await mountEntry();
  await waitUntil(
    () => adapter.cancels >= 2 && adapter.pending.length === 0,
    "the reloaded launch to cancel the armed plan",
  );
  await finishIntroduction(second);
  assert.equal(adapter.schedules.length, 1, "the welcome schedules nothing");
  await click(second, en["auth.signInTitle"]);
  await click(second, `Continue as ${A_ACCOUNT.email}`);
  await waitUntil(
    () => second.text().includes(en["ui.skipToContent"]) && adapter.schedules.length === 2,
    "the resumed plan",
  );
  await settle();

  assert.equal(adapter.schedules.length, 2, "the reload schedules the plan once");
  assert.deepEqual(titlesOf(adapter.schedules[1]), [
    "A private bill is due in 7 days",
  ]);
  assert.equal(adapter.pending.length, 1, "the device holds no duplicate");
});

test("a failed entry cancellation blocks the app and resumes after a retry", async () => {
  await seedAccount(A_ID, "A private bill");
  await seedOwner(A_ID);
  adapter.pending = [
    {
      id: 1,
      title: "A private bill is due in 7 days",
      fireAt: Date.now() + 86_400_000,
    },
  ];
  adapter.failCancel = true;
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(() => adapter.cancels >= 1, "the attempted entry cancellation");
  await walkIntroduction(app);
  await waitUntil(
    () => app.text().includes(en["auth.teardownTitle"]),
    "the blocking recovery surface",
  );
  assert.equal(adapter.schedules.length, 0, "a failed suspension schedules nothing");
  assert.equal(adapter.pending.length, 1, "the failed cancellation leaves the alarm");

  adapter.failCancel = false;
  await click(app, en["app.retry"]);
  await waitUntil(
    () => app.text().includes(en["auth.welcomeBlurb"]),
    "the welcome after the retry",
  );
  await click(app, en["auth.signInTitle"]);
  await click(app, `Continue as ${A_ACCOUNT.email}`);
  await waitUntil(
    () => app.text().includes(en["ui.skipToContent"]) && adapter.schedules.length === 1,
    "the plan after recovery",
  );

  assert.deepEqual(titlesOf(adapter.schedules[0]), [
    "A private bill is due in 7 days",
  ]);
  assert.equal(adapter.pending.length, 1);
});

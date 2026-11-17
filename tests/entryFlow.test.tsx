/**
 * The launch entry flow, end to end through AppEntry.
 *
 * Every launch must show the introduction, then the authentication choice, even
 * when Supabase restores a session. These tests drive the production components
 * with a recording Supabase client and the real account coordinator, so the
 * bypass these guard against — a restored session opening the previous account
 * before the choice — is exercised through the actual entry code.
 */
import test from "node:test";
import { register } from "node:module";

register("./tsx-loader.mjs", import.meta.url);

// Must be set before the client module is loaded: it captures the pair at
// module scope, exactly as a Next build would inline it.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://livanta-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

import { assert, makeThing } from "./helpers.ts";
import type { Dict } from "../lib/locales/en.ts";

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
const { ha } = await import("../lib/locales/ha.ts");
const { loadSettings } = await import("../lib/settings.ts");
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
const {
  setReminderOwnerStorageForTesting,
} = await import("../lib/reminders/ownerMarker.ts");
const { createLocalStore, userScope } = await import("../lib/db.ts");
const { DEFAULT_SETTINGS, saveSettings } = await import("../lib/settings.ts");

type Session = import("@supabase/supabase-js").Session;
type Root = import("react-dom/client").Root;

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NEW_ID = "99999999-9999-4999-8999-999999999999";

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
  /** The account sign-up created, and the credentials it was asked to use. */
  readonly signUps: Array<{ email: string; password: string }>;
  readonly signIns: Array<{ email: string; password: string }>;
  readonly signOuts: number;
  setSession: (session: Session | null) => void;
  emit: (event: AuthEvent, session: Session | null) => void;
}

function fakeClient(options: {
  session: Session | null;
  accounts: readonly Account[];
  /** Mimics a Supabase project that requires a confirmed email. */
  confirmEmail?: boolean;
}): FakeClient {
  let current = options.session;
  let listener: ((event: AuthEvent, session: Session | null) => void) | null =
    null;
  const accounts = [...options.accounts];
  const signUps: Array<{ email: string; password: string }> = [];
  const signIns: Array<{ email: string; password: string }> = [];
  let signOuts = 0;
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
        signOuts += 1;
        current = null;
        listener?.("SIGNED_OUT", null);
        return { error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        signIns.push({ email, password });
        const account = accounts.find(
          (candidate) => candidate.email === email && candidate.password === password,
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
        signUps.push({ email, password });
        const account = { id: NEW_ID, email, password };
        accounts.push(account);
        if (options.confirmEmail) {
          return { data: { session: null, user: { id: NEW_ID } }, error: null };
        }
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
    get signUps() {
      return signUps;
    },
    get signIns() {
      return signIns;
    },
    get signOuts() {
      return signOuts;
    },
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitUntil(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    // React 19 holds updates scheduled inside one long act() until it exits, so
    // each poll is its own short act that commits whatever settled meanwhile.
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
  assert.ok(found, `a "${label}" button is available; text=${JSON.stringify(app.text())}`);
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
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  });
}

async function submit(app: Mounted): Promise<void> {
  const form = app.container.querySelector("form");
  assert.ok(form, "the auth form exists");
  await act(async () => {
    form.dispatchEvent(
      new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    );
    await delay(10);
  });
}

/** Walks the three introduction slides to the authentication welcome. */
async function finishIntroduction(app: Mounted): Promise<void> {
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
  await waitUntil(
    () => app.text().includes(en["auth.welcomeBlurb"]),
    "the authentication welcome",
  );
}

async function seedOnboarded(userId: string): Promise<void> {
  const store = createLocalStore(userScope(userId));
  await saveSettings(store, { ...DEFAULT_SETTINGS, onboarded: true });
  await store.close();
}

/** Picks Hausa in the introduction's language field and waits for the switch. */
async function pickHausa(app: Mounted): Promise<void> {
  const chip = [...app.container.querySelectorAll("button")].find(
    (button) => button.getAttribute("lang") === "ha",
  );
  assert.ok(chip, "the introduction offers Hausa");
  await act(async () => {
    (chip as unknown as HTMLElement).click();
    await delay(10);
  });
  await waitUntil(
    () => app.text().includes(ha["intro.welcomeBody"]),
    "the introduction in Hausa",
  );
}

/** Walks the three slides in whichever language the introduction is showing. */
async function finishIntroductionIn(
  app: Mounted,
  dict: Pick<
    Dict,
    | "intro.continue"
    | "intro.getStarted"
    | "intro.organisedBody"
    | "intro.controlBody"
  >,
): Promise<void> {
  await click(app, dict["intro.continue"]);
  await waitUntil(
    () => app.text().includes(dict["intro.organisedBody"]),
    "the second slide",
  );
  await click(app, dict["intro.continue"]);
  await waitUntil(
    () => app.text().includes(dict["intro.controlBody"]),
    "the third slide",
  );
  await click(app, dict["intro.getStarted"]);
}

let client: FakeClient;
const workingLocks = () => ({
  request: async (
    _name: string,
    _options: { signal: AbortSignal },
    callback: () => Promise<void>,
  ) => {
    await callback();
  },
});

const A_ACCOUNT: Account = {
  id: A_ID,
  email: "previous@example.com",
  password: "previous-password",
};

test.beforeEach(async () => {
  resetAuthForTesting();
  resetAccountTransitionForTesting();
  resetReminderSchedulingForTesting();
  resetIdentityChannelForTesting();
  setIdentityTransportForTesting(null);
  setSupabaseForTesting(null);
  resetEntryGateForTesting();
  // A launch starts with whatever language this device last chose.
  win.localStorage.removeItem("livanta.entry.locale.v1");

  const device = new Map<string, string>();
  setReminderOwnerStorageForTesting({
    getItem: (key) => device.get(key) ?? null,
    setItem: (key, value) => {
      device.set(key, value);
    },
  });
  setReminderAdapterForTesting({
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    cancelAll: async () => {},
    schedule: async () => {},
  });
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

test("first launch shows the introduction, never the previous account", async () => {
  await seedOnboarded(A_ID);
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["intro.welcomeBody"]),
    "the introduction's first slide",
  );

  assert.equal(
    app.text().includes(en["auth.welcomeBlurb"]),
    false,
    "the authentication choice is not reached before the introduction ends",
  );
  assert.equal(
    app.text().includes(en["ui.skipToContent"]),
    false,
    "the restored session's account never renders before the choice",
  );
  assert.equal(
    app.text().includes("Step 1 of 3"),
    true,
    "the introduction reports its progress accessibly",
  );
});

test("finishing the introduction shows the authentication welcome with both choices", async () => {
  client = fakeClient({ session: null, accounts: [] });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await finishIntroduction(app);

  assert.equal(app.text().includes(en["auth.newToLivanta"]), true);
  assert.equal(app.text().includes(en["auth.alreadyHaveAccount"]), true);
  assert.ok(buttonNamed(app, en["auth.signUpTitle"]));
  assert.ok(buttonNamed(app, en["auth.signInTitle"]));
  assert.equal(
    app.text().includes(en["ui.skipToContent"]),
    false,
    "no unauthenticated visitor reaches the app",
  );
});

test("Create Account opens a blank registration form, not the previous identity", async () => {
  await seedOnboarded(A_ID);
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await finishIntroduction(app);
  await click(app, en["auth.signUpTitle"]);

  const email = app.container.querySelector<HTMLInputElement>("#a-email");
  assert.ok(email, "the registration form has an email field");
  assert.equal(email.value, "", "the previous account's address is not prefilled");
  assert.ok(app.container.querySelector("#a-password"), "the registration form has a password field");
  assert.equal(
    app.text().includes(A_ACCOUNT.email),
    false,
    "the previous identity is not shown in registration",
  );
});

test("Sign In opens the login form and offers the restored session explicitly", async () => {
  await seedOnboarded(A_ID);
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await finishIntroduction(app);
  await click(app, en["auth.signInTitle"]);

  const email = app.container.querySelector<HTMLInputElement>("#a-email");
  assert.ok(email);
  assert.equal(email.value, "", "the login form starts empty");
  const continueAs = `Continue as ${A_ACCOUNT.email}`;
  await waitUntil(
    () => app.text().includes(continueAs),
    "the explicit way back into the restored session",
  );

  await click(app, continueAs);
  await waitUntil(
    () => app.text().includes(en["ui.skipToContent"]),
    "the previous account only after the explicit choice",
  );
  assert.equal(
    app.text().includes(en["auth.welcomeBlurb"]),
    false,
    "the welcome is behind us once the session is chosen",
  );
});

test("a restored session cannot silently bypass the entry flow", async () => {
  await seedOnboarded(A_ID);
  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await finishIntroduction(app);

  assert.equal(
    app.text().includes(en["ui.skipToContent"]),
    false,
    "the restored session does not open the app",
  );
  assert.equal(
    app.text().includes(A_ACCOUNT.email),
    false,
    "the welcome does not announce the restored identity",
  );
});

test("a new user can register with a different address without touching the previous account", async () => {
  await seedOnboarded(A_ID);
  const storeA = createLocalStore(userScope(A_ID));
  await storeA.putThing(makeThing({ id: "a-private", name: "Previous account's bill" }));
  await storeA.close();

  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await finishIntroduction(app);
  await click(app, en["auth.signUpTitle"]);

  setInput(app.container, "#a-email", "new@example.com");
  setInput(app.container, "#a-password", "new-password");
  await submit(app);

  await waitUntil(
    () => getAccountTransitionCoordinator().currentUserId() === NEW_ID,
    "the new account to activate",
  );
  await waitUntil(
    () => app.text().includes(en["ob.welcome"]),
    "the new account's own first-run setup",
  );

  assert.deepEqual(
    client.signUps,
    [{ email: "new@example.com", password: "new-password" }],
    "the new registration used the address the user typed",
  );
  assert.equal(client.signOuts, 0, "registering did not sign out the previous account");

  const newStore = getAccountTransitionCoordinator().currentStore();
  assert.ok(newStore);
  assert.deepEqual(
    await newStore.getAllThings(),
    [],
    "the new account starts with its own empty desk",
  );

  // The previous account's records were neither deleted nor migrated.
  const checkA = createLocalStore(userScope(A_ID));
  const aThings = await checkA.getAllThings();
  await checkA.close();
  assert.deepEqual(
    aThings.map((thing) => thing.id),
    ["a-private"],
    "the previous account's records are intact",
  );
});

test("an unconfirmed registration stays at the gate and never reaches the app", async () => {
  client = fakeClient({ session: null, accounts: [], confirmEmail: true });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await finishIntroduction(app);
  await click(app, en["auth.signUpTitle"]);
  setInput(app.container, "#a-email", "waiting@example.com");
  setInput(app.container, "#a-password", "waiting-password");
  await submit(app);

  await waitUntil(
    () => app.text().includes(en["auth.checkEmail"]),
    "the confirmation-pending notice",
  );
  assert.equal(
    app.text().includes(en["ui.skipToContent"]),
    false,
    "an unconfirmed account has no session and no app",
  );
  assert.equal(getAccountTransitionCoordinator().currentUserId(), null);
  const unconfirmed = createLocalStore(userScope(NEW_ID));
  assert.deepEqual(
    await unconfirmed.getAllThings(),
    [],
    "nothing is written before a session exists",
  );
  await unconfirmed.close();
});

test("signing in from the welcome opens that account, and never a different one", async () => {  await seedOnboarded(A_ID);
  client = fakeClient({ session: null, accounts: [A_ACCOUNT] });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await finishIntroduction(app);
  await click(app, en["auth.signInTitle"]);
  setInput(app.container, "#a-email", A_ACCOUNT.email);
  setInput(app.container, "#a-password", A_ACCOUNT.password);
  await submit(app);

  await waitUntil(
    () => app.text().includes(en["ui.skipToContent"]),
    "the signed-in account's app",
  );
  assert.equal(getAccountTransitionCoordinator().currentUserId(), A_ID);
  assert.deepEqual(client.signIns, [
    { email: A_ACCOUNT.email, password: A_ACCOUNT.password },
  ]);
});

test("the introduction's language carries into the welcome and registration", async () => {
  client = fakeClient({ session: null, accounts: [] });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["intro.welcomeBody"]),
    "the introduction's first slide",
  );
  await pickHausa(app);
  assert.equal(
    app.text().includes(en["intro.welcomeBody"]),
    false,
    "the whole introduction switched, not just its picker",
  );

  await finishIntroductionIn(app, ha);
  await waitUntil(
    () => app.text().includes(ha["auth.welcomeBlurb"]),
    "the welcome in the chosen language",
  );

  assert.equal(app.text().includes(en["auth.welcomeBlurb"]), false);
  assert.equal(app.text().includes(ha["auth.newToLivanta"]), true);
  assert.equal(app.text().includes(ha["auth.alreadyHaveAccount"]), true);
  assert.ok(buttonNamed(app, ha["auth.signUpTitle"]));
  assert.ok(buttonNamed(app, ha["auth.signInTitle"]));
  assert.equal(
    app.container.querySelector(".app")?.getAttribute("lang"),
    "ha",
    "the gate declares the language it is rendered in",
  );

  await click(app, ha["auth.signUpTitle"]);
  await waitUntil(
    () => app.text().includes(ha["auth.signUpBlurb"]),
    "the registration form in the chosen language",
  );
  assert.equal(app.text().includes(en["auth.signUpBlurb"]), false);
});

test("the chosen language seeds first-run onboarding and is saved with the account", async () => {
  // The account is signed in but has not finished onboarding on this device.
  const storeA = createLocalStore(userScope(A_ID));
  await saveSettings(storeA, { ...DEFAULT_SETTINGS });
  await storeA.close();

  client = fakeClient({
    session: sessionFor(A_ID, A_ACCOUNT.email),
    accounts: [A_ACCOUNT],
  });
  setSupabaseForTesting(
    client as unknown as import("@supabase/supabase-js").SupabaseClient,
  );

  const app = await mountEntry();
  await waitUntil(
    () => app.text().includes(en["intro.welcomeBody"]),
    "the introduction's first slide",
  );
  await pickHausa(app);
  await finishIntroductionIn(app, ha);
  await waitUntil(
    () => app.text().includes(ha["auth.welcomeBlurb"]),
    "the welcome in the chosen language",
  );

  await click(app, ha["auth.signInTitle"]);
  const continueAs = ha["auth.continueAs"].replace("{email}", A_ACCOUNT.email);
  await waitUntil(
    () => app.text().includes(continueAs),
    "the restored session behind the welcome",
  );
  await click(app, continueAs);

  await waitUntil(
    () => app.text().includes(ha["ob.welcome"]),
    "first-run onboarding in the chosen language",
  );
  assert.equal(
    app.container.querySelector(".ob")?.getAttribute("lang"),
    "ha",
    "onboarding declares the chosen language",
  );
  assert.equal(
    app.container.querySelector('.ob button[lang="ha"]')?.getAttribute("aria-pressed"),
    "true",
    "onboarding's picker already shows the chosen language",
  );

  await click(app, ha["ob.getStarted"]);
  await click(app, ha["ob.continue"]);
  await click(app, ha["ob.skipNow"]);
  await click(app, ha["ob.skipExplore"]);
  await click(app, ha["ob.notNow"]);

  await waitUntil(
    () => app.text().includes(ha["ui.skipToContent"]),
    "the app in the language chosen at entry",
  );
  const store = createLocalStore(userScope(A_ID));
  const saved = await loadSettings(store);
  await store.close();
  assert.equal(saved.locale, "ha", "the chosen language is saved with the account");
  assert.equal(saved.onboarded, true);
});

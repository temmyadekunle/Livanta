/**
 * Registration redirects from a localhost page.
 *
 * The page's own origin is not automatically the right destination: a build
 * that is production (or an external beta) must never put localhost in an
 * email, because the recipient's phone cannot open it. These tests drive the
 * real auth store from a localhost window and read the options it hands to
 * Supabase, so the policy is pinned at the call site and not only in the
 * resolver.
 */

import test from "node:test";
import { register } from "node:module";

register("./tsx-loader.mjs", import.meta.url);

// Must be set before the client module is loaded: it captures the pair at
// module scope, exactly as a Next build would inline it.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://livanta-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

import { assert } from "./helpers.ts";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { Window } = await import("happy-dom");
const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");

const LOCAL_ORIGIN = "http://localhost:3100";
const win = new Window({ url: `${LOCAL_ORIGIN}/` });
define("window", win);
define("document", win.document);
define("navigator", win.navigator);
define("location", win.location);
define("indexedDB", indexedDB);
define("IDBKeyRange", IDBKeyRange);
define("IS_REACT_ACT_ENVIRONMENT", true);

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { useAuth, resetAuthForTesting } = await import("../lib/useAuth.ts");
const { setSupabaseForTesting } = await import("../lib/supabase/client.ts");
const {
  PUBLISHED_AUTH_ORIGIN,
  setAuthRedirectEnvironmentForTesting,
} = await import("../lib/authRedirect.ts");
const {
  beginReminderTransition,
  completeReminderTransition,
  setReminderOwnerStorageForTesting,
} = await import("../lib/reminders/ownerMarker.ts");
const { setLockManager } = await import("../lib/identityLock.ts");
const {
  resetReminderSchedulingForTesting,
  setReminderAdapterForTesting,
} = await import("../lib/schedule.ts");

type UseAuth = ReturnType<typeof useAuth>;

interface Capture {
  signUp?: { email: string; password: string; options?: { emailRedirectTo?: string } };
  reset?: { email: string; options?: { redirectTo?: string } };
  resend?: { type: string; email: string; options?: { emailRedirectTo?: string } };
}

function fakeClient(capture: Capture) {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signUp: async (credentials: NonNullable<Capture["signUp"]>) => {
        capture.signUp = credentials;
        return {
          data: {
            session: null,
            user: { id: "new-user", identities: [{ provider: "email" }] },
          },
          error: null,
        };
      },
      resetPasswordForEmail: async (
        email: string,
        options?: { redirectTo?: string },
      ) => {
        capture.reset = { email, options };
        return { error: null };
      },
      resend: async (credentials: NonNullable<Capture["resend"]>) => {
        capture.resend = credentials;
        return { error: null };
      },
      signInWithPassword: async () => ({ error: null }),
      signInWithOAuth: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await act(async () => {
      await delay(5);
    });
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function mount() {
  let latest: UseAuth | undefined;
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);

  function Probe() {
    latest = useAuth();
    return null;
  }

  act(() => root.render(<Probe />));

  return {
    get auth(): UseAuth {
      if (!latest) throw new Error("the auth store never rendered");
      return latest;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

let device: Map<string, string>;

test.beforeEach(() => {
  resetAuthForTesting();
  setSupabaseForTesting(null);
  win.localStorage.clear();
  setAuthRedirectEnvironmentForTesting(null);
  device = new Map();
  setReminderOwnerStorageForTesting({
    getItem: (key) => device.get(key) ?? null,
    setItem: (key, value) => {
      device.set(key, value);
    },
  });
  completeReminderTransition(beginReminderTransition(null));
  setLockManager({
    request: async (_name, _options, callback) => {
      await callback();
    },
  });
  setReminderAdapterForTesting({
    checkPermissions: async () => ({ display: "granted" }),
    requestPermissions: async () => ({ display: "granted" }),
    cancelAll: async () => {},
    schedule: async () => {},
  });
});

test.afterEach(() => {
  setSupabaseForTesting(null);
  setReminderOwnerStorageForTesting(null);
  resetReminderSchedulingForTesting();
  setLockManager(null);
  setAuthRedirectEnvironmentForTesting(null);
});

test("a production build served from localhost emails the published origin", async () => {
  setAuthRedirectEnvironmentForTesting({ configuredOrigin: null, isProduction: true });
  const capture: Capture = {};
  setSupabaseForTesting(fakeClient(capture));
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the signed-out gate");

  await act(async () => {
    const outcome = await view.auth.signUp("new@example.com", "secret123");
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.userId, "new-user");
    assert.equal(
      outcome.ok && outcome.newAccount,
      true,
      "a registration with an identity may seed the local profile",
    );
  });
  await act(async () => {
    assert.equal(await view.auth.resetPassword("new@example.com"), true);
  });
  await act(async () => {
    const outcome = await view.auth.resendConfirmation("new@example.com");
    assert.equal(outcome.ok, true);
  });

  const destinations = [
    capture.signUp?.options?.emailRedirectTo,
    capture.reset?.options?.redirectTo,
    capture.resend?.options?.emailRedirectTo,
  ];
  for (const destination of destinations) {
    assert.equal(destination, `${PUBLISHED_AUTH_ORIGIN}/auth/confirm/`);
    assert.equal(
      destination?.includes("localhost"),
      false,
      "an emailed link must never point at the recipient's own machine",
    );
  }

  view.unmount();
});

test("local development still emails the running local server", async () => {
  setAuthRedirectEnvironmentForTesting({ configuredOrigin: null, isProduction: false });
  const capture: Capture = {};
  setSupabaseForTesting(fakeClient(capture));
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the signed-out gate");

  await act(async () => {
    await view.auth.signUp("new@example.com", "secret123");
  });

  assert.equal(
    capture.signUp?.options?.emailRedirectTo,
    `${LOCAL_ORIGIN}/auth/confirm/`,
    "a developer testing locally can follow the link on the same machine",
  );

  view.unmount();
});

test("a configured beta origin replaces localhost on every email flow", async () => {
  setAuthRedirectEnvironmentForTesting({
    configuredOrigin: "https://beta.livanta.test",
    isProduction: true,
  });
  const capture: Capture = {};
  setSupabaseForTesting(fakeClient(capture));
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the signed-out gate");

  await act(async () => {
    await view.auth.signUp("new@example.com", "secret123");
    await view.auth.resetPassword("new@example.com");
    await view.auth.resendConfirmation("new@example.com");
  });

  assert.equal(
    capture.signUp?.options?.emailRedirectTo,
    "https://beta.livanta.test/auth/confirm/",
  );
  assert.equal(
    capture.reset?.options?.redirectTo,
    "https://beta.livanta.test/auth/confirm/",
  );
  assert.equal(
    capture.resend?.options?.emailRedirectTo,
    "https://beta.livanta.test/auth/confirm/",
  );

  view.unmount();
});

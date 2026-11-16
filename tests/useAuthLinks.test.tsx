/**
 * The auth store's handling of emailed links.
 *
 * Supabase exchanges a link's fragment for a session inside its own client. A
 * failed link therefore never reaches the app as an auth event: the client
 * reports an error, keeps whatever session it already had, and a later
 * `getSession()` looks like an ordinary signed-in launch. These tests pin the
 * app's half of that contract: read the failure before the client touches the
 * URL, keep an existing account visible with an explanation, and never read or
 * clear a fragment that carries tokens.
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

const win = new Window({ url: "https://livanta.test/" });
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
const { resolveAppSurface } = await import("../lib/authGate.ts");
const { setSupabaseForTesting } = await import("../lib/supabase/client.ts");
const { setReminderOwnerStorageForTesting } = await import(
  "../lib/reminders/ownerMarker.ts"
);
const { beginReminderTransition, completeReminderTransition } = await import(
  "../lib/reminders/ownerMarker.ts"
);
const { setLockManager } = await import("../lib/identityLock.ts");
const {
  setReminderAdapterForTesting,
  resetReminderSchedulingForTesting,
} = await import("../lib/schedule.ts");

type UseAuth = ReturnType<typeof useAuth>;
type Session = import("@supabase/supabase-js").Session;

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const EXPIRED_HASH =
  "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

function sessionFor(id: string, email: string): Session {
  return {
    access_token: "secret-access-token",
    refresh_token: "secret-refresh-token",
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

interface Capture {
  signUp?: { email: string; password: string; options?: { emailRedirectTo?: string } };
  signUpCalls?: number;
  reset?: { email: string; options?: { redirectTo?: string } };
  resend?: {
    type: string;
    email: string;
    options?: { emailRedirectTo?: string };
  };
  oauth: Array<{ provider: string; options?: { redirectTo?: string } }>;
  signOvers?: number;
}

interface FakeOutcomes {
  signInError?: string;
  resendError?: string;
  /** The shape GoTrue uses for an address that already has an account. */
  signUpUser?: { id: string; identities?: unknown[] };
}

function fakeClient(
  capture: Capture,
  session: Session | null,
  outcomes: FakeOutcomes = {},
) {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signUp: async (credentials: NonNullable<Capture["signUp"]>) => {
        capture.signUp = credentials;
        capture.signUpCalls = (capture.signUpCalls ?? 0) + 1;
        return {
          data: {
            session: null,
            user: outcomes.signUpUser ?? { id: "new-user" },
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
        return {
          error: outcomes.resendError
            ? { message: outcomes.resendError }
            : null,
        };
      },
      signInWithOAuth: async (options: {
        provider: string;
        options?: { redirectTo?: string };
      }) => {
        capture.oauth.push(options);
        return { error: null };
      },
      signInWithPassword: async () => ({
        error: outcomes.signInError
          ? { message: outcomes.signInError }
          : null,
      }),
      updateUser: async () => ({ error: null }),
      signOut: async () => {
        capture.signOvers = (capture.signOvers ?? 0) + 1;
        return { error: null };
      },
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

let device: Map<string, string>;

test.beforeEach(() => {
  resetAuthForTesting();
  setSupabaseForTesting(null);
  win.localStorage.clear();
  win.location.hash = "";
  // The store treats an absent owner marker as unproven and blocks on a
  // cancellation. A signed-out device with no owner is the clean baseline.
  device = new Map();
  setReminderOwnerStorageForTesting({
    getItem: (key) => device.get(key) ?? null,
    setItem: (key, value) => {
      device.set(key, value);
    },
  });
  completeReminderTransition(beginReminderTransition(null));
  // Publishing an account passes through the identity lock and a reminder
  // cancellation, so the test supplies both instead of a native runtime.
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
  win.location.hash = "";
});

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

test("sign-up, reset and OAuth all return to the origin that submitted the form", async () => {
  const capture: Capture = { oauth: [] };
  setSupabaseForTesting(fakeClient(capture, null));
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the signed-out gate");

  let signUpOutcome: Awaited<ReturnType<UseAuth["signUp"]>> | null = null;
  await act(async () => {
    signUpOutcome = await view.auth.signUp("new@example.com", "secret123");
  });
  assert.deepEqual(signUpOutcome, { ok: true, needsEmailConfirmation: true });
  assert.equal(capture.signUp?.email, "new@example.com");
  assert.equal(
    capture.signUp?.options?.emailRedirectTo,
    "https://livanta.test/",
    "confirmation returns to this origin rather than the project Site URL",
  );

  await act(async () => {
    assert.equal(await view.auth.resetPassword("new@example.com"), true);
  });
  assert.equal(capture.reset?.options?.redirectTo, "https://livanta.test/");

  await act(async () => {
    assert.equal(await view.auth.signInWithGoogle(), true);
    assert.equal(await view.auth.signInWithApple(), true);
  });
  assert.deepEqual(
    capture.oauth.map((call) => call.provider),
    ["google", "apple"],
  );
  assert.deepEqual(
    capture.oauth.map((call) => call.options?.redirectTo),
    ["https://livanta.test/", "https://livanta.test/"],
  );

  view.unmount();
});

test("a failed confirmation keeps the earlier account visible and explains why", async () => {
  win.location.hash = EXPIRED_HASH;
  setSupabaseForTesting(fakeClient({ oauth: [] }, sessionFor(A_ID, "a@example.com")));
  const view = mount();

  await waitFor(
    () => view.auth.status === "signed-in",
    "the existing session to be published",
  );
  assert.equal(view.auth.user?.id, A_ID);
  assert.equal(
    view.auth.confirmationError,
    "expired",
    "the failed link is surfaced even though the client kept the old session",
  );
  assert.equal(
    win.location.hash,
    "",
    "the failure is removed from the address bar",
  );
  assert.equal(
    win.location.href.includes("secret-access-token"),
    false,
    "no token is carried in the address bar",
  );

  act(() => view.auth.clearConfirmationError());
  assert.equal(view.auth.confirmationError, null);
  view.unmount();
});

test("a failed confirmation with no session stays signed out and opens no account store", async () => {
  win.location.hash = EXPIRED_HASH;
  setSupabaseForTesting(fakeClient({ oauth: [] }, null));
  const view = mount();

  await waitFor(
    () => view.auth.status === "signed-out",
    "the signed-out gate after a failed link",
  );
  assert.equal(view.auth.user, null);
  assert.equal(view.auth.confirmationError, "expired");

  const databases = await indexedDB.databases();
  assert.deepEqual(
    databases.filter((database) =>
      (database.name ?? "").startsWith("lifedesk:user:"),
    ),
    [],
    "no account database may be created for an unconfirmed identity",
  );
  view.unmount();
});

test("a token-bearing fragment is left for the client to exchange", async () => {
  win.location.hash =
    "#access_token=secret-access-token&refresh_token=secret-refresh-token&type=signup";
  setSupabaseForTesting(fakeClient({ oauth: [] }, null));
  const view = mount();

  await waitFor(() => view.auth.status === "signed-out", "the session read");
  assert.equal(view.auth.confirmationError, null);
  assert.equal(
    win.location.hash.includes("access_token"),
    true,
    "stripping a successful fragment would spend the single-use link",
  );
  view.unmount();
});

test("signing out clears a failed-link notice", async () => {
  win.location.hash = EXPIRED_HASH;
  setSupabaseForTesting(fakeClient({ oauth: [] }, sessionFor(A_ID, "a@example.com")));
  const view = mount();

  await waitFor(
    () => view.auth.status === "signed-in" && view.auth.confirmationError === "expired",
    "the notice beside the existing account",
  );

  await act(async () => {
    await view.auth.signOut();
  });
  assert.equal(view.auth.status, "signed-out");
  assert.equal(view.auth.confirmationError, null);
  view.unmount();
});

test("a resend targets the submitting origin and reports only what Supabase answered", async () => {
  const capture: Capture = { oauth: [] };
  setSupabaseForTesting(fakeClient(capture, null));
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the gate");

  let outcome!: Awaited<ReturnType<UseAuth["resendConfirmation"]>>;
  await act(async () => {
    outcome = await view.auth.resendConfirmation("new@example.com");
  });
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(capture.resend, {
    type: "signup",
    email: "new@example.com",
    options: { emailRedirectTo: "https://livanta.test/" },
  });
  view.unmount();
});

test("a rate-limited resend is reported, not claimed as sent", async () => {
  const capture: Capture = { oauth: [] };
  setSupabaseForTesting(
    fakeClient(capture, null, {
      // GoTrue's per-address cooldown contains neither "rate limit" nor
      // "too many", which is why it needs its own pattern.
      resendError: "For security purposes, you can only request this after 38 seconds.",
    }),
  );
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the gate");

  let outcome!: Awaited<ReturnType<UseAuth["resendConfirmation"]>>;
  await act(async () => {
    outcome = await view.auth.resendConfirmation("new@example.com");
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.code, "rate-limited");
  view.unmount();
});

test("a failed resend reports the network, not a sent state", async () => {
  const capture: Capture = { oauth: [] };
  setSupabaseForTesting(
    fakeClient(capture, null, { resendError: "Failed to fetch" }),
  );
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the gate");

  let outcome!: Awaited<ReturnType<UseAuth["resendConfirmation"]>>;
  await act(async () => {
    outcome = await view.auth.resendConfirmation("new@example.com");
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.code, "network");
  view.unmount();
});

test("an unconfirmed sign-in opens the pending prompt instead of a generic error", async () => {
  const capture: Capture = { oauth: [] };
  setSupabaseForTesting(
    fakeClient(capture, null, { signInError: "Email not confirmed" }),
  );
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the gate");

  let signedIn = true;
  await act(async () => {
    signedIn = await view.auth.signIn("waiting@example.com", "secret123");
  });
  assert.equal(signedIn, false);
  assert.equal(
    view.auth.error,
    null,
    "the user is not shown the generic failure instead",
  );
  assert.equal(view.auth.needsEmailConfirmation, true);
  assert.equal(view.auth.pendingEmail, "waiting@example.com");
  assert.equal(view.auth.status, "signed-out");
  assert.equal(
    win.localStorage.getItem("livanta.auth.pendingConfirmation.v1"),
    "1",
  );
  assert.equal(
    win.localStorage.getItem("livanta.auth.pendingEmail.v1"),
    "waiting@example.com",
  );
  // No session exists, so the pending flag cannot open the dashboard.
  assert.deepEqual(
    resolveAppSurface({
      ready: true,
      onboarded: true,
      authEnabled: true,
      authStatus: view.auth.status,
      passwordResetReady: view.auth.passwordResetReady,
    }),
    { kind: "auth-gate" },
  );
  view.unmount();
});

test("changing the email forgets only the local pending prompt", async () => {
  const capture: Capture = { oauth: [] };
  setSupabaseForTesting(
    fakeClient(capture, null, { signInError: "Email not confirmed" }),
  );
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the gate");

  await act(async () => {
    await view.auth.signIn("wrong@example.com", "secret123");
  });
  assert.equal(view.auth.needsEmailConfirmation, true);

  await act(async () => {
    view.auth.clearPendingConfirmation();
  });
  assert.equal(view.auth.needsEmailConfirmation, false);
  assert.equal(view.auth.pendingEmail, null);
  assert.equal(
    win.localStorage.getItem("livanta.auth.pendingConfirmation.v1"),
    null,
  );
  assert.equal(win.localStorage.getItem("livanta.auth.pendingEmail.v1"), null);
  assert.equal(view.auth.status, "signed-out");
  assert.equal(
    capture.signUpCalls ?? 0,
    0,
    "correcting the address never recreates an account",
  );
  assert.equal(capture.signOvers ?? 0, 0, "and never signs anything out");
  view.unmount();
});

test("a resend beside a signed-in account keeps that account", async () => {
  const capture: Capture = { oauth: [] };
  win.location.hash = EXPIRED_HASH;
  setSupabaseForTesting(
    fakeClient(capture, sessionFor(A_ID, "a@example.com")),
  );
  const view = mount();
  await waitFor(
    () =>
      view.auth.status === "signed-in" &&
      view.auth.confirmationError === "expired",
    "the notice beside the existing account",
  );

  let outcome!: Awaited<ReturnType<UseAuth["resendConfirmation"]>>;
  await act(async () => {
    outcome = await view.auth.resendConfirmation("waiting@example.com");
  });
  assert.deepEqual(outcome, { ok: true });
  assert.equal(view.auth.status, "signed-in");
  assert.equal(view.auth.user?.id, A_ID);
  assert.equal(view.auth.confirmationError, "expired");
  assert.equal(capture.signOvers ?? 0, 0, "the resend never signs out");
  view.unmount();
});

test("signing up again for the same pending address stays on the prompt", async () => {
  const capture: Capture = { oauth: [] };
  setSupabaseForTesting(
    fakeClient(capture, null, {
      // What GoTrue returns for an address that already exists: no session and
      // no identities, indistinguishable from a fresh sign-up by design.
      signUpUser: { id: "existing-user", identities: [] },
    }),
  );
  const view = mount();
  await waitFor(() => view.auth.status === "signed-out", "the gate");

  let first: Awaited<ReturnType<UseAuth["signUp"]>> | null = null;
  let second: Awaited<ReturnType<UseAuth["signUp"]>> | null = null;
  await act(async () => {
    first = await view.auth.signUp("same@example.com", "secret123");
  });
  await act(async () => {
    second = await view.auth.signUp("same@example.com", "secret123");
  });
  assert.deepEqual(first, { ok: true, needsEmailConfirmation: true });
  assert.deepEqual(second, { ok: true, needsEmailConfirmation: true });
  assert.equal(view.auth.error, null, "an existing account is not an error");
  assert.equal(view.auth.pendingEmail, "same@example.com");

  await act(async () => {
    await view.auth.resendConfirmation("same@example.com");
  });
  assert.equal(
    capture.signUpCalls,
    2,
    "a resend asks for another email, never another account",
  );
  assert.equal(view.auth.pendingEmail, "same@example.com");
  view.unmount();
});

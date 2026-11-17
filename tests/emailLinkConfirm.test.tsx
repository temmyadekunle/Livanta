/**
 * The `/auth/confirm/` handover.
 *
 * These tests drive the hook that page uses, with a fake GoTrue client, and
 * check the parts that matter outside the UI: the exact `verifyOtp` input, the
 * URL left behind, the auth store's proof flags, and that neither storage nor
 * the console ever sees the token. The legacy implicit fragment is still
 * handed to the root unchanged so projects on the default template keep
 * working.
 */

import test from "node:test";
import { register } from "node:module";
import { StrictMode } from "react";

register("./tsx-loader.mjs", import.meta.url);

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
const {
  setReminderOwnerStorageForTesting,
  beginReminderTransition,
  completeReminderTransition,
} = await import("../lib/reminders/ownerMarker.ts");
const { setLockManager } = await import("../lib/identityLock.ts");
const {
  setReminderAdapterForTesting,
  resetReminderSchedulingForTesting,
} = await import("../lib/schedule.ts");
const { useEmailLinkConfirmation } = await import(
  "../lib/useEmailLinkConfirmation.ts"
);
const { AUTH_CONFIRM_PATH } = await import("../lib/authTokenHash.ts");

type Session = import("@supabase/supabase-js").Session;
type UseAuth = ReturnType<typeof useAuth>;
type Confirmation = ReturnType<typeof useEmailLinkConfirmation>;

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TOKEN = "a".repeat(56);
const OTHER = "b".repeat(56);

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

interface VerifyCapture {
  token_hash?: string;
  type?: string;
}

interface VerifyOutcome {
  error?: { code: string; message: string; status?: number };
  session?: Session | null;
  /** When false, behave like an older client and do not announce the session. */
  notify?: boolean;
}

function fakeClient(outcome: VerifyOutcome = {}) {
  const verifyCalls: VerifyCapture[] = [];
  let current: Session | null = null;
  let notify: ((event: string, session: Session | null) => void) | null = null;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      onAuthStateChange: (
        callback: (event: string, session: Session | null) => void,
      ) => {
        notify = callback;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      verifyOtp: async (params: VerifyCapture) => {
        verifyCalls.push(params);
        if (outcome.error) {
          return { data: { session: null, user: null }, error: outcome.error };
        }
        if (outcome.session === null) {
          return { data: { session: null, user: null }, error: null };
        }
        const session = outcome.session ?? sessionFor(A_ID, "a@example.com");
        current = session;
        if (outcome.notify !== false) {
          notify?.(
            params.type === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN",
            session,
          );
        }
        return { data: { session, user: session.user }, error: null };
      },
      signOut: async () => ({ error: null }),
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
  return { client, verifyCalls, setCurrent: (s: Session | null) => (current = s) };
}

let device: Map<string, string>;
let latestAuth: UseAuth | undefined;
let latest: Confirmation | undefined;
let consoleCalls: string[];
let restoreConsole: (() => void) | null = null;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    if (check()) return;
    await act(async () => {
      await delay(5);
    });
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function mountAuth() {
  latestAuth = undefined;
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  function Probe() {
    latestAuth = useAuth();
    return null;
  }
  act(() => root.render(<Probe />));
  return {
    get auth(): UseAuth {
      if (!latestAuth) throw new Error("the auth store never rendered");
      return latestAuth;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function mountConfirmation(strict = false) {
  latest = undefined;
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  function Probe() {
    latest = useEmailLinkConfirmation();
    return null;
  }
  act(() => {
    root.render(strict ? <StrictMode><Probe /></StrictMode> : <Probe />);
  });
  return {
    get confirmation(): Confirmation {
      if (!latest) throw new Error("the confirmation hook never rendered");
      return latest;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function goTo(path: string): void {
  win.history.replaceState(null, "", path);
}

test.beforeEach(() => {
  resetAuthForTesting();
  setSupabaseForTesting(null);
  win.localStorage.clear();
  win.sessionStorage.clear();
  goTo("/");
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
  consoleCalls = [];
  const originals: Array<
    [("log" | "info" | "warn" | "error" | "debug"), (...data: unknown[]) => void]
  > = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[method];
    originals.push([method, original]);
    console[method] = (...args: unknown[]) => {
      consoleCalls.push(args.map(String).join(" "));
      original.apply(console, args);
    };
  }
  restoreConsole = () => {
    for (const [method, original] of originals) console[method] = original;
  };
});

test.afterEach(() => {
  restoreConsole?.();
  restoreConsole = null;
  setSupabaseForTesting(null);
  setReminderOwnerStorageForTesting(null);
  resetReminderSchedulingForTesting();
  setLockManager(null);
  goTo("/");
});

function assertNoTokenPersisted(): void {
  for (const storage of [win.localStorage, win.sessionStorage]) {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i) ?? "";
      const value = storage.getItem(key) ?? "";
      assert.equal(key.includes(TOKEN), false, key);
      assert.equal(value.includes(TOKEN), false, key);
      assert.equal(value.includes(OTHER), false, key);
    }
  }
  for (const line of consoleCalls) {
    assert.equal(line.includes(TOKEN), false, "the token reached the console");
    assert.equal(line.includes(OTHER), false, "the token reached the console");
  }
}

test("a signup token hash is exchanged once and opens the authenticated app", async () => {
  const fake = fakeClient();
  setSupabaseForTesting(fake.client);
  goTo(`${AUTH_CONFIRM_PATH}#token_hash=${TOKEN}&type=signup`);

  const view = mountConfirmation();
  await waitFor(() => view.confirmation.phase === "ready", "the approved phase");
  const auth = mountAuth();
  await waitFor(() => auth.auth.status === "signed-in", "the confirmed session");

  assert.deepEqual(fake.verifyCalls, [{ token_hash: TOKEN, type: "signup" }]);
  assert.equal(auth.auth.emailLinkAuthenticated, true);
  assert.equal(auth.auth.emailLinkVerifying, false);
  assert.equal(auth.auth.emailLinkAttempted, true);
  assert.equal(auth.auth.confirmationError, null);
  assert.equal(win.location.pathname, "/");
  assert.equal(win.location.hash, "");
  assert.equal(win.location.search, "");
  assert.equal(win.location.href.includes(TOKEN), false);

  assert.deepEqual(
    resolveAppSurface({
      ready: true,
      onboarded: true,
      authEnabled: true,
      authStatus: auth.auth.status,
      passwordResetReady: auth.auth.passwordResetReady,
      entryChoicePending: false,
    }),
    { kind: "app" },
  );

  assertNoTokenPersisted();
  auth.unmount();
  view.unmount();
});

test("a recovery token hash arms the new-password flow", async () => {
  const fake = fakeClient();
  setSupabaseForTesting(fake.client);
  goTo(`${AUTH_CONFIRM_PATH}#token_hash=${TOKEN}&type=recovery`);

  const view = mountConfirmation();
  await waitFor(() => view.confirmation.phase === "ready", "the approved phase");
  const auth = mountAuth();
  await waitFor(() => auth.auth.status === "signed-in", "the recovery session");

  assert.deepEqual(fake.verifyCalls, [{ token_hash: TOKEN, type: "recovery" }]);
  assert.equal(auth.auth.passwordResetReady, true);
  assert.equal(auth.auth.emailLinkAuthenticated, true);
  assert.equal(win.location.pathname, "/");
  assert.equal(win.location.href.includes(TOKEN), false);

  assert.deepEqual(
    resolveAppSurface({
      ready: true,
      onboarded: true,
      authEnabled: true,
      authStatus: auth.auth.status,
      passwordResetReady: true,
      entryChoicePending: false,
    }),
    { kind: "recovery" },
  );

  assertNoTokenPersisted();
  auth.unmount();
  view.unmount();
});

test("an expired token is explained and leaves the gate closed", async () => {
  const fake = fakeClient({
    error: {
      code: "otp_expired",
      message: "Email link is invalid or has expired",
      status: 403,
    },
  });
  setSupabaseForTesting(fake.client);
  goTo(`${AUTH_CONFIRM_PATH}#token_hash=${TOKEN}&type=signup`);

  const view = mountConfirmation();
  await waitFor(() => view.confirmation.phase === "failed", "the failure phase");
  assert.equal(view.confirmation.error, "expired");

  const auth = mountAuth();
  await waitFor(() => auth.auth.emailLinkAttempted, "the attempt marker");
  assert.equal(auth.auth.status, "signed-out");
  assert.equal(auth.auth.emailLinkAuthenticated, false);
  assert.equal(auth.auth.confirmationError, "expired");
  assert.equal(win.location.pathname, AUTH_CONFIRM_PATH);
  assert.equal(win.location.search, "");
  assert.equal(win.location.hash, "");
  assert.equal(win.location.href.includes(TOKEN), false);

  act(() => view.confirmation.back());
  assert.equal(view.confirmation.phase, "ready");
  assert.equal(win.location.pathname, "/");
  assert.equal(auth.auth.confirmationError, "expired");

  assertNoTokenPersisted();
  auth.unmount();
  view.unmount();
});

test("an invalid token is reported without claiming it expired", async () => {
  const fake = fakeClient({
    error: { code: "otp_disabled", message: "Token has been revoked", status: 403 },
  });
  setSupabaseForTesting(fake.client);
  goTo(`${AUTH_CONFIRM_PATH}#token_hash=${TOKEN}&type=signup`);

  const view = mountConfirmation();
  await waitFor(() => view.confirmation.phase === "failed", "the failure phase");
  assert.equal(view.confirmation.error, "invalid");
  assertNoTokenPersisted();
  view.unmount();
});

test("a token that yields no session does not authenticate", async () => {
  const fake = fakeClient({ session: null });
  setSupabaseForTesting(fake.client);
  goTo(`${AUTH_CONFIRM_PATH}#token_hash=${TOKEN}&type=signup`);

  const view = mountConfirmation();
  await waitFor(() => view.confirmation.phase === "failed", "the failure phase");
  assert.equal(view.confirmation.error, "invalid");

  const auth = mountAuth();
  await waitFor(() => auth.auth.emailLinkAttempted, "the attempt marker");
  assert.equal(auth.auth.status, "signed-out");
  assert.equal(auth.auth.emailLinkAuthenticated, false);
  assertNoTokenPersisted();
  auth.unmount();
  view.unmount();
});

test("malformed fragments and queries never reach verifyOtp", async () => {
  const cases = [
    `#token_hash=${TOKEN}&type=magiclink`,
    `#token_hash=${TOKEN}`,
    "#token_hash=short&type=signup",
    `#token_hash=${TOKEN.toUpperCase()}&type=signup`,
    `#token_hash=${TOKEN}&token_hash=${OTHER}&type=signup`,
    `#token_hash=${TOKEN}&type=signup&access_token=secret`,
    `?token_hash=${TOKEN}&type=signup&type=recovery`,
    `?token_hash=short&type=recovery`,
  ];

  for (const suffix of cases) {
    const fake = fakeClient();
    setSupabaseForTesting(fake.client);
    resetAuthForTesting();
    goTo(`${AUTH_CONFIRM_PATH}${suffix}`);
    const view = mountConfirmation();
    await waitFor(() => view.confirmation.phase === "failed", suffix);
    assert.equal(view.confirmation.error, "invalid", suffix);
    assert.equal(fake.verifyCalls.length, 0, suffix);
    assert.equal(win.location.href.includes(TOKEN), false, suffix);
    assert.equal(win.location.href.includes(OTHER), false, suffix);
    assertNoTokenPersisted();
    view.unmount();
  }
});

test("a direct visit to the confirmation path is not treated as a session", async () => {
  const fake = fakeClient();
  setSupabaseForTesting(fake.client);
  goTo(AUTH_CONFIRM_PATH);

  const view = mountConfirmation();
  await waitFor(() => view.confirmation.phase === "failed", "the missing-token phase");
  assert.equal(view.confirmation.error, "invalid");
  assert.equal(fake.verifyCalls.length, 0);
  view.unmount();
});

test("the legacy implicit fragment is moved to the root untouched", async () => {
  const fake = fakeClient();
  setSupabaseForTesting(fake.client);
  const fragment =
    "#access_token=legacy-token&expires_in=3600&refresh_token=legacy-refresh&token_type=bearer&type=signup";
  goTo(`${AUTH_CONFIRM_PATH}${fragment}`);

  const view = mountConfirmation();
  await waitFor(() => view.confirmation.phase === "ready", "the legacy handover");

  assert.equal(fake.verifyCalls.length, 0);
  assert.equal(win.location.pathname, "/");
  assert.equal(win.location.hash, fragment);
  view.unmount();
});

test("the legacy failure fragment keeps its explanation route", async () => {
  const fake = fakeClient();
  setSupabaseForTesting(fake.client);
  const fragment = "#error=access_denied&error_code=otp_expired";
  goTo(`${AUTH_CONFIRM_PATH}${fragment}`);

  const view = mountConfirmation();
  await waitFor(() => view.confirmation.phase === "ready", "the legacy failure handover");
  assert.equal(win.location.pathname, "/");
  assert.equal(win.location.hash, fragment);
  view.unmount();
});

test("a duplicate effect does not exchange the same link twice", async () => {
  const fake = fakeClient();
  setSupabaseForTesting(fake.client);
  goTo(`${AUTH_CONFIRM_PATH}#token_hash=${TOKEN}&type=signup`);

  const view = mountConfirmation(true);
  await waitFor(() => view.confirmation.phase === "ready", "the approved phase");
  assert.equal(fake.verifyCalls.length, 1);
  assertNoTokenPersisted();
  view.unmount();
});

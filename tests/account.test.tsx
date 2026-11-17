/**
 * The signed-out, unconfigured path.
 *
 * Every existing user is on this path today, so it is the one that must not
 * break: with no Supabase credentials the app has to behave exactly as it did
 * before accounts existed.
 */

import test from "node:test";
import { register } from "node:module";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { assert } from "./helpers.ts";
import { en } from "../lib/locales/en.ts";
import { makeT } from "../lib/i18n.ts";

register("./tsx-loader.mjs", import.meta.url);

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { Window } = await import("happy-dom");
const win = new Window({ url: "https://livanta.test/" });
define("window", win);
define("document", win.document);
define("navigator", win.navigator);
define("location", win.location);
define("IS_REACT_ACT_ENVIRONMENT", true);

const { isCloudEnabled, getSupabase } = await import("../lib/supabase/client.ts");
const { AccountPanel } = await import("../components/AccountPanel.tsx");
const { AuthScreen } = await import("../components/AuthScreen.tsx");

/* Supabase's User carries more than the email these tests care about, and the
   auth surface types it structurally. */
const fakeUser = {
  id: "user-1",
  email: "someone@example.com",
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
  app_metadata: {},
  user_metadata: {},
} as unknown as import("@supabase/supabase-js").User;

test("no credentials means cloud sync reports itself unavailable", () => {
  assert.equal(isCloudEnabled(), false);
  assert.equal(getSupabase(), null);
});

test("getSupabase does not throw when unconfigured", () => {
  // Callers rely on this returning null rather than throwing, because the
  // profile screen renders for signed-out users on every build.
  assert.doesNotThrow(() => getSupabase());
});

test("AccountPanel renders the unavailable notice instead of a sign-in form", async () => {
  const t = makeT("en");
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);

  const auth = {
    enabled: false,
    status: "disabled" as const,
    user: null,
    error: null,
    needsEmailConfirmation: false,
    passwordResetReady: false,
    confirmationError: null,
    emailLinkAuthenticated: false,
    emailLinkVerifying: false,
    emailLinkAttempted: false,
    clearConfirmationError: () => {},
    pendingEmail: null,
    resendConfirmation: async () => ({ ok: true as const }),
    clearPendingConfirmation: () => {},
    signIn: async () => false,
    signUp: async () => ({ ok: false as const }),
    signOut: async () => {},
    teardownPending: false,
    retryTransition: async () => {},
    resetPassword: async () => true,
    updatePassword: async () => true,
    cancelPasswordReset: () => {},
    clearError: () => {},
    retrySession: async () => {},
    signInWithGoogle: async () => false,
    signInWithApple: async () => false,
  };
  const sync = {
    enabled: false,
    signedIn: false,
    phase: "idle" as const,
    lastResult: null,
    online: true,
    dataSaver: false,
    bindRefresh: () => {},
    scheduleSync: () => {},
    syncNow: async () => {},
  };

  await act(async () => {
    root.render(<AccountPanel t={t} auth={auth} sync={sync} />);
  });

  const text = container.textContent ?? "";

  // It must not offer a way to sign in that cannot work.
  assert.equal(text.includes(t("account.notConfigured")), true);
  assert.equal(text.includes(t("account.signIn")), false);
  assert.equal(text.includes("password"), false);

  await act(async () => {
    root.unmount();
  });
});

test("the account and sync keys exist in every catalogue", async () => {
  const t = makeT("en");
  for (const key of [
    "account.title",
    "account.notConfigured",
    "sync.offline",
    "auth.unknown",
  ] as const) {
    assert.equal(typeof en[key], "string", `${key} missing from en`);
    assert.equal(t(key).length > 0, true, `${key} is empty`);
  }
});

/* A recovery link establishes a real session, so status is "signed-in" by the
   time the user reaches this screen. Before the fix the signed-in branch ran
   first and won, so the new-password form could never appear and the link did
   nothing at all. Assert the form is reachable in exactly that state. */
test("a recovery session shows the new-password form, not the signed-in panel", async () => {
  const t = makeT("en");
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);

  const auth = {
    enabled: true,
    status: "signed-in" as const,
    user: fakeUser,
    error: null,
    needsEmailConfirmation: false,
    passwordResetReady: true,
    confirmationError: null,
    emailLinkAuthenticated: false,
    emailLinkVerifying: false,
    emailLinkAttempted: false,
    clearConfirmationError: () => {},
    pendingEmail: null,
    resendConfirmation: async () => ({ ok: true as const }),
    clearPendingConfirmation: () => {},
    signIn: async () => false,
    signUp: async () => ({ ok: false as const }),
    signOut: async () => {},
    teardownPending: false,
    retryTransition: async () => {},
    resetPassword: async () => true,
    updatePassword: async () => true,
    cancelPasswordReset: () => {},
    clearError: () => {},
    retrySession: async () => {},
    signInWithGoogle: async () => false,
    signInWithApple: async () => false,
  };

  await act(async () => {
    root.render(<AuthScreen t={t} auth={auth} onClose={() => {}} onDone={() => {}} />);
  });

  const text = container.textContent ?? "";

  assert.equal(text.includes(t("auth.newPasswordTitle")), true);
  assert.equal(text.includes(t("auth.savePassword")), true);
  // The signed-in panel must not be what the user sees.
  assert.equal(text.includes(t("account.signOut")), false);
  // And there is no way back to a sign-in form, because a recovery session
  // cannot sign in again without the token.
  assert.equal(text.includes(t("auth.backToSignIn")), false);

  await act(async () => {
    root.unmount();
  });
});

test("an ordinary signed-in session still shows the signed-in panel", async () => {
  const t = makeT("en");
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);

  const auth = {
    enabled: true,
    status: "signed-in" as const,
    user: fakeUser,
    error: null,
    needsEmailConfirmation: false,
    passwordResetReady: false,
    confirmationError: null,
    emailLinkAuthenticated: false,
    emailLinkVerifying: false,
    emailLinkAttempted: false,
    clearConfirmationError: () => {},
    pendingEmail: null,
    resendConfirmation: async () => ({ ok: true as const }),
    clearPendingConfirmation: () => {},
    signIn: async () => false,
    signUp: async () => ({ ok: false as const }),
    signOut: async () => {},
    teardownPending: false,
    retryTransition: async () => {},
    resetPassword: async () => true,
    updatePassword: async () => true,
    cancelPasswordReset: () => {},
    clearError: () => {},
    retrySession: async () => {},
    signInWithGoogle: async () => false,
    signInWithApple: async () => false,
  };

  await act(async () => {
    root.render(<AuthScreen t={t} auth={auth} onClose={() => {}} onDone={() => {}} />);
  });

  const text = container.textContent ?? "";

  // Guards the other direction: the fix must not leak the recovery form into
  // normal use.
  assert.equal(text.includes(t("account.signOut")), true);
  assert.equal(text.includes(t("auth.savePassword")), false);

  await act(async () => {
    root.unmount();
  });
});
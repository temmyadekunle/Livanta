/**
 * Session state for optional cloud sync.
 *
 * Every method is safe to call when the app was built without Supabase
 * credentials: `enabled` is false, `user` stays null and the sign-in methods
 * report a translated-friendly error instead of throwing. That is what lets the
 * signed-out experience stay exactly as it is today.
 *
 * Note that no password ever touches this module's callers beyond the moment of
 * submission, and the session itself is held by supabase-js in local storage.
 *
 * The state lives in a module-level store rather than in each hook call. The
 * app calls `useAuth()` from both LivantaApp and useCloudSync, and two separate
 * instances each held their own `user` plus their own onAuthStateChange
 * subscription. That could drift: the UI could show signed-in while sync still
 * believed it was signed out, and the second subscription was pure overhead.
 * One store means one subscription, one session, and one error to read.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";

import { getSupabase, isCloudEnabled } from "./supabase/client.ts";
import { createSessionAttempts, withTimeout } from "./sessionTimeout.ts";
import { performSignOut } from "./signOut.ts";

/**
 * `error` is a terminal fail-closed state: the persisted session could not be
 * read, so the app must not guess whether someone is signed in. It is only
 * left through an explicit retry, which moves back to `loading`.
 */
export type AuthStatus =
  | "disabled"
  | "loading"
  | "signed-out"
  | "signed-in"
  | "error";

export interface AuthError {
  /** A key from the translation catalogue, so the UI stays multilingual. */
  code:
    | "invalid-credentials"
    | "email-taken"
    | "rate-limited"
    | "sign-out-failed"
    | "unknown";
  message: string;
}

/**
 * Sign-up reports the confirmation requirement as part of its result rather
 * than only through the store. A component that reads the store immediately
 * after awaiting the call is still holding the pre-submit render's snapshot,
 * which made a confirmation-required sign-up claim the user was signed in.
 */
export type SignUpOutcome =
  | { readonly ok: true; readonly needsEmailConfirmation: boolean }
  | { readonly ok: false };

export interface UseAuth {
  enabled: boolean;
  status: AuthStatus;
  user: User | null;
  error: AuthError | null;
  /** True right after signing up on a project that requires email confirmation. */
  needsEmailConfirmation: boolean;
  /**
   * True when the session in hand came from an emailed recovery link, so the
   * only sensible next step is choosing a new password. See the PASSWORD_RECOVERY
   * branch in the subscription below for why this is not just `signed-in`.
   */
  passwordResetReady: boolean;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<SignUpOutcome>;
  /** Sends a password-reset email. */
  resetPassword: (email: string) => Promise<boolean>;
  /** Completes a reset once the user has followed the emailed link. */
  updatePassword: (password: string) => Promise<boolean>;
  /**
   * Leaves the recovery flow when the session it depended on is gone, so the
   * user can get back to an ordinary sign-in instead of facing a form that can
   * never succeed.
   */
  cancelPasswordReset: () => void;
  signOut: () => Promise<void>;
  clearError: () => void;
  /** Re-reads the persisted session after an initialization failure. */
  retrySession: () => Promise<void>;
  /** Sign in with Google OAuth. */
  signInWithGoogle: () => Promise<boolean>;
  /** Sign in with Apple OAuth. */
  signInWithApple: () => Promise<boolean>;
}

/**
 * Supabase error codes are matched rather than shown raw, so the user sees a
 * translated explanation instead of an English library string in a Hausa or
 * Yoruba interface.
 */
function toAuthError(error: { message: string } | null): AuthError {
  const message = error?.message ?? "";
  if (/invalid login credentials/i.test(message)) {
    return { code: "invalid-credentials", message };
  }
  if (/already registered|already exists/i.test(message)) {
    return { code: "email-taken", message };
  }
  if (/rate limit|too many/i.test(message)) {
    return { code: "rate-limited", message };
  }
  return { code: "unknown", message };
}

/**
 * The "confirm your email" prompt has to outlive a re-render and a reload,
 * otherwise the only signal is a toast that disappears before the user can
 * find the message. Only a boolean is stored: no address or token.
 */
const PENDING_CONFIRMATION_KEY = "livanta.auth.pendingConfirmation.v1";

function readPendingConfirmation(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem(PENDING_CONFIRMATION_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function writePendingConfirmation(pending: boolean): void {
  try {
    if (typeof window === "undefined") return;
    if (pending) window.localStorage.setItem(PENDING_CONFIRMATION_KEY, "1");
    else window.localStorage.removeItem(PENDING_CONFIRMATION_KEY);
  } catch {
    /* private browsing */
  }
}

interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: AuthError | null;
  needsEmailConfirmation: boolean;
  passwordResetReady: boolean;
}

/** Seeded from a constant, so an unconfigured build never needs a state update. */
function initialState(): AuthState {
  return {
    status: isCloudEnabled() ? "loading" : "disabled",
    user: null,
    error: null,
    needsEmailConfirmation: isCloudEnabled() && readPendingConfirmation(),
    passwordResetReady: false,
  };
}

let state: AuthState = initialState();
const listeners = new Set<() => void>();
let started = false;

/**
 * Replaces the state object rather than mutating it, which is what lets
 * useSyncExternalStore see a new reference and re-render.
 */
function emit(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

const getSnapshot = () => state;

/**
 * Reads the persisted session and publishes a definitive status. Any failure
 * lands in `error` rather than staying in `loading`: an unreadable session is
 * not evidence of being signed out, and it is certainly not permission to show
 * the dashboard.
 *
 * The read is bounded so a storage backend that never answers cannot hold the
 * app on the splash screen. Every settle also checks an attempt token, so a
 * response from an older read can never overwrite a newer retry or an auth
 * event that arrived while the read was in flight.
 */
const sessionAttempts = createSessionAttempts();

async function applySession(): Promise<void> {
  const attempt = sessionAttempts.begin();
  const supabase = getSupabase();
  if (!supabase) {
    if (sessionAttempts.current(attempt)) {
      emit({ user: null, status: "error" });
    }
    return;
  }

  try {
    const { data, error } = await withTimeout(supabase.auth.getSession());
    if (error) throw error;
    if (!sessionAttempts.current(attempt)) return;

    if (data.session) {
      writePendingConfirmation(false);
      emit({
        user: data.session.user,
        status: "signed-in",
        needsEmailConfirmation: false,
      });
    } else {
      emit({ user: null, status: "signed-out" });
    }
  } catch {
    if (!sessionAttempts.current(attempt)) return;
    emit({ user: null, status: "error" });
  }
}

function start() {
  if (started) return;
  started = true;

  if (!isCloudEnabled()) return;
  const supabase = getSupabase();
  if (!supabase) {
    emit({ user: null, status: "error" });
    return;
  }

  // Deliberately not torn down when the last hook unmounts. Tearing it down
  // would drop the session mid-navigation and re-run getSession on every mount,
  // which is the churn the shared store exists to remove. Supabase's
  // subscription lives for the lifetime of the page, as it would in any app.
  supabase.auth.onAuthStateChange((event, session) => {
    // An auth event is strictly newer than any session read still in flight,
    // so the read's answer must not land on top of it.
    sessionAttempts.invalidate();

    if (session) {
      writePendingConfirmation(false);
      emit({
        user: session.user,
        status: "signed-in",
        needsEmailConfirmation: false,
      });
    } else {
      emit({ user: null, status: "signed-out" });
    }

    // A recovery link establishes a real session, so `status` alone reads as an
    // ordinary sign-in and the app would show the signed-in screen instead of
    // asking for the new password the user came to set. Only this event arms the
    // reset flow, and nothing else disarms it: TOKEN_REFRESHED fires straight
    // afterwards and must not clear the flag out from under the form.
    if (event === "PASSWORD_RECOVERY") {
      emit({ passwordResetReady: true, needsEmailConfirmation: false });
    }
  });

  void applySession();
}

async function retrySession(): Promise<void> {
  emit({ status: "loading", user: null });
  await applySession();
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAuth(): UseAuth {
  const enabled = isCloudEnabled();
  const session = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const signIn = useCallback(async (email: string, password: string) => {
    emit({ error: null });
    const supabase = getSupabase();
    if (!supabase) return false;

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      emit({ error: toAuthError(signInError) });
      return false;
    }
    writePendingConfirmation(false);
    emit({ needsEmailConfirmation: false });
    return true;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string): Promise<SignUpOutcome> => {
      emit({ error: null, needsEmailConfirmation: false });
      const supabase = getSupabase();
      if (!supabase) return { ok: false };

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signUpError) {
        emit({ error: toAuthError(signUpError) });
        return { ok: false };
      }
      // When email confirmation is switched on in the Supabase project there is
      // no session yet. Say so, and keep saying so across reloads, otherwise the
      // only signal is a toast that disappears before the user can act on it.
      const needsEmailConfirmation = !data.session && Boolean(data.user);
      writePendingConfirmation(needsEmailConfirmation);
      emit({ needsEmailConfirmation });
      return { ok: true, needsEmailConfirmation };
    },
    [],
  );

  const resetPassword = useCallback(async (email: string) => {
    emit({ error: null });
    const supabase = getSupabase();
    if (!supabase) return false;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      // Supabase appends the token to this and redirects back into the app.
      { redirectTo: `${window.location.origin}${window.location.pathname}` },
    );
    if (resetError) {
      emit({ error: toAuthError(resetError) });
      return false;
    }
    return true;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    emit({ error: null });
    const supabase = getSupabase();
    if (!supabase) return false;

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      emit({ error: toAuthError(updateError) });
      return false;
    }
    // The reset is done, so stop forcing the new-password form on the next
    // render. Clearing only on success means an expired or already-used link
    // leaves the form up with its error rather than dropping the user back to a
    // sign-in screen that cannot explain what went wrong.
    emit({ passwordResetReady: false });
    return true;
  }, []);

  const cancelPasswordReset = useCallback(() => {
    emit({ passwordResetReady: false, error: null });
  }, []);

  const signOut = useCallback(async () => {
    // A session read that was already in flight is older than this sign-out
    // attempt and must not restore the session after it completes.
    sessionAttempts.invalidate();
    emit({ error: null });
    const supabase = getSupabase();
    const result = await performSignOut(supabase);
    if (!result.ok) {
      // The session is still the one in hand, so the flags stay as they are and
      // the user sees why signing out did not happen.
      emit({
        error: { code: "sign-out-failed", message: result.message },
      });
      return;
    }
    writePendingConfirmation(false);
    // Supabase normally emits SIGNED_OUT as well, but publishing the result
    // here means a successful sign-out is reflected immediately even if that
    // event is delayed.
    emit({
      user: null,
      status: "signed-out",
      needsEmailConfirmation: false,
      passwordResetReady: false,
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    emit({ error: null });
    const supabase = getSupabase();
    if (!supabase) return false;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
      },
    });
    if (error) {
      emit({ error: toAuthError(error) });
      return false;
    }
    return true;
  }, []);

  const signInWithApple = useCallback(async () => {
    emit({ error: null });
    const supabase = getSupabase();
    if (!supabase) return false;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
      },
    });
    if (error) {
      emit({ error: toAuthError(error) });
      return false;
    }
    return true;
  }, []);

  const clearError = useCallback(() => emit({ error: null }), []);

  return {
    enabled,
    status: session.status,
    user: session.user,
    error: session.error,
    needsEmailConfirmation: session.needsEmailConfirmation,
    passwordResetReady: session.passwordResetReady,
    signIn,
    signUp,
    resetPassword,
    updatePassword,
    cancelPasswordReset,
    signOut,
    clearError,
    retrySession,
    signInWithGoogle,
    signInWithApple,
  };
}

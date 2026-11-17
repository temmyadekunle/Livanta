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
import type { Session, User } from "@supabase/supabase-js";

import { getSupabase, isCloudEnabled } from "./supabase/client.ts";
import { createSessionAttempts, withTimeout } from "./sessionTimeout.ts";
import { performSignOut } from "./signOut.ts";
import { readSessionOwner } from "./sessionAuthority.ts";
import { authRedirectUrl } from "./authRedirect.ts";
import {
  parseAuthLinkError,
  parseConfirmationLinkAccessToken,
  type AuthLinkError,
} from "./authLinkError.ts";
import {
  AUTH_CONFIRM_PATH,
  isTokenHashLink,
  type TokenHashLink,
} from "./authTokenHash.ts";
import { identityTransportKind } from "./identityTransport.ts";
import { isEntryChoicePending } from "./entryGate.ts";
import {
  ensureReminderOwner,
  signedOutReminderRecoveryNeeded,
} from "./reminders/ownerTransition.ts";

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
    | "email-unconfirmed"
    | "rate-limited"
    | "network"
    | "sign-out-failed"
    | "teardown-failed"
    | "unsupported-browser"
    | "unknown";
  message: string;
}

/** A resend either reached Supabase or explains why it did not. */
export type ResendOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: AuthError };

/** The result of presenting an emailed token hash, without the token. */
export type EmailLinkOutcome =
  | { readonly ok: true; readonly type: TokenHashLink["type"] }
  | { readonly ok: false; readonly error: AuthLinkError };

/**
 * Sign-up reports the confirmation requirement as part of its result rather
 * than only through the store. A component that reads the store immediately
 * after awaiting the call is still holding the pre-submit render's snapshot,
 * which made a confirmation-required sign-up claim the user was signed in.
 */
export type SignUpOutcome =
  | {
      readonly ok: true;
      readonly needsEmailConfirmation: boolean;
      /**
       * Present when Supabase returned a user object. `newAccount` is true only
       * when Supabase also returned an identity, which distinguishes a fresh
       * registration from its deliberately obfuscated existing-email response.
       */
      readonly userId?: string;
      readonly newAccount?: boolean;
    }
  | { readonly ok: false };

/**
 * Local teardown the app runs after the remote session has ended. Returning
 * `{ ok: false }` keeps the app on a blocking recovery surface: the account is
 * signed out, but its reminders or store were not released, so no other
 * account may activate yet.
 */
export type TeardownCallback = () => Promise<{ ok: boolean } | void>;

export interface UseAuth {
  enabled: boolean;
  status: AuthStatus;
  user: User | null;
  error: AuthError | null;
  /** True right after signing up on a project that requires email confirmation. */
  needsEmailConfirmation: boolean;
  /**
   * The failure carried by the URL of a confirmation or recovery link, read
   * once at startup. Null when there was no failed link.
   */
  confirmationError: AuthLinkError | null;
  /**
   * True when this launch's session came from a successfully exchanged
   * sign-up confirmation link. Only a session whose access token matches the
   * link's fragment proves this; a restored or unrelated session never does.
   * The entry gate uses it to skip this launch's introduction and explicit
   * account choice without weakening either for ordinary sessions.
   */
  emailLinkAuthenticated: boolean;
  /**
   * A token-hash link from this launch is being exchanged with Supabase. The
   * entry gate holds while this is true so a restored session cannot be shown
   * before the link has either succeeded or failed.
   */
  emailLinkVerifying: boolean;
  /**
   * A token-hash link was received in this launch, even if it was invalid.
   * The introduction is skipped so a broken link is explained immediately,
   * but the authentication choice is not: only a verified link proves an
   * identity.
   */
  emailLinkAttempted: boolean;
  /**
   * True when the session in hand came from an emailed recovery link, so the
   * only sensible next step is choosing a new password. See the PASSWORD_RECOVERY
   * branch in the subscription below for why this is not just `signed-in`.
   */
  passwordResetReady: boolean;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<SignUpOutcome>;
  /**
   * Sends another confirmation email. Reports the answer rather than assuming
   * it: the UI may only claim an email was sent when `ok` is true.
   */
  resendConfirmation: (email: string) => Promise<ResendOutcome>;
  /**
   * The address awaiting confirmation on this device, when one is known.
   * Stored only so the prompt can resend without retyping it; no token.
   */
  pendingEmail: string | null;
  /**
   * Forgets the local pending-confirmation prompt. This is presentation state
   * only: no account is deleted or changed by it.
   */
  clearPendingConfirmation: () => void;
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
  signOut: (onSignedOut?: TeardownCallback) => Promise<void>;
  /**
   * True when the remote session ended but local teardown has not succeeded.
   * No account may activate while this is set; see `retryTransition`.
   */
  teardownPending: boolean;
  /** Re-runs the failed local teardown of the account that just signed out. */
  retryTransition: () => Promise<void>;
  clearError: () => void;
  /** Hides the failed-link notice after the user has seen it. */
  clearConfirmationError: () => void;
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
  if (/email not confirmed|email_not_confirmed/i.test(message)) {
    return { code: "email-unconfirmed", message };
  }
  // GoTrue's per-address cooldown has neither "rate limit" nor "too many" in it.
  if (/rate limit|too many|for security purposes|only request this after/i.test(message)) {
    return { code: "rate-limited", message };
  }
  if (/failed to fetch|network|load failed|fetch failed/i.test(message)) {
    return { code: "network", message };
  }
  return { code: "unknown", message };
}

/**
 * The "confirm your email" prompt has to outlive a re-render and a reload,
 * otherwise the only signal is a toast that disappears before the user can
 * find the message. The address is kept beside the flag so a resend does not
 * need it retyped; no token is ever stored.
 */
const PENDING_CONFIRMATION_KEY = "livanta.auth.pendingConfirmation.v1";
const PENDING_EMAIL_KEY = "livanta.auth.pendingEmail.v1";

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

function readPendingEmail(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const email = window.localStorage.getItem(PENDING_EMAIL_KEY)?.trim();
    return email ? email : null;
  } catch {
    return null;
  }
}

function writePendingConfirmation(pending: boolean, email?: string): void {
  try {
    if (typeof window === "undefined") return;
    if (pending) {
      window.localStorage.setItem(PENDING_CONFIRMATION_KEY, "1");
      if (email !== undefined) {
        window.localStorage.setItem(PENDING_EMAIL_KEY, email.trim());
      }
    } else {
      window.localStorage.removeItem(PENDING_CONFIRMATION_KEY);
      window.localStorage.removeItem(PENDING_EMAIL_KEY);
    }
  } catch {
    /* private browsing */
  }
}

interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: AuthError | null;
  needsEmailConfirmation: boolean;
  pendingEmail: string | null;
  confirmationError: AuthLinkError | null;
  emailLinkAuthenticated: boolean;
  emailLinkVerifying: boolean;
  emailLinkAttempted: boolean;
  passwordResetReady: boolean;
  teardownPending: boolean;
}

/** Seeded from a constant, so an unconfigured build never needs a state update. */
function initialState(): AuthState {
  return {
    status: isCloudEnabled() ? "loading" : "disabled",
    user: null,
    error: null,
    needsEmailConfirmation: isCloudEnabled() && readPendingConfirmation(),
    pendingEmail: isCloudEnabled() ? readPendingEmail() : null,
    confirmationError: null,
    emailLinkAuthenticated: false,
    emailLinkVerifying: false,
    emailLinkAttempted: false,
    passwordResetReady: false,
    teardownPending: false,
  };
}

let state: AuthState = initialState();
const listeners = new Set<() => void>();
let started = false;

/**
 * The access token from a confirmation fragment read before supabase-js
 * consumes the URL. It is compared once, in memory, with the session the
 * client actually publishes; it is never persisted or exposed.
 */
let confirmationLinkToken: string | null = null;

let sessionAttempts = createSessionAttempts();

/**
 * The app root registers how to release a session that ended without an
 * explicit sign-out call — Supabase expiry, or another tab replacing it. It
 * records the app-wide coordinator, so it survives the remount performed when
 * the auth status changes.
 */
let registeredSessionTeardown: TeardownCallback | null = null;

/**
 * The teardown to retry after the remote sign-out succeeded but local teardown
 * failed. It is a pending operation rather than renderable state, so it lives
 * outside the store; the store carries only the `teardownPending` flag.
 */
let pendingTeardown: TeardownCallback | null = null;

/** One settlement at a time, shared by every caller that observes the same end. */
let settlingTeardown: Promise<boolean> | null = null;

/**
 * The newest session Supabase has announced but which has not been published.
 * It is held here when a teardown must finish first, so a foreign tab's session
 * cannot appear over the outgoing account.
 */
let queuedSession: Session | null = null;
let drainingSessions: Promise<void> | null = null;

/** The account whose session is currently published in this tab. */
let activeUserId: string | null = null;

/** Registers the teardown used when Supabase ends a session on its own. */
export function registerSessionTeardown(
  teardown: TeardownCallback | null,
): void {
  registeredSessionTeardown = teardown;
}

/** Clears auth module state between tests. */
export function resetAuthForTesting(): void {
  state = initialState();
  listeners.clear();
  started = false;
  sessionAttempts = createSessionAttempts();
  registeredSessionTeardown = null;
  pendingTeardown = null;
  settlingTeardown = null;
  queuedSession = null;
  drainingSessions = null;
  activeUserId = null;
  confirmationLinkToken = null;
}

function teardownSucceeded(result: { ok: boolean } | void): boolean {
  return result === undefined || result.ok;
}

function teardownFailure(): AuthError {
  return {
    code: "teardown-failed",
    message:
      "You are signed out, but this device could not finish clearing the previous account. Nothing else can open until it does.",
  };
}

/**
 * An auth-enabled build needs at least one way to tell other tabs that the
 * session changed before it may open an account store (ADR 0002 D5/B2.2). No
 * transport is a capability failure, not a retryable network error.
 */
function transportUnavailable(): boolean {
  return isCloudEnabled() && identityTransportKind() === "unavailable";
}

function unsupportedTransportError(): AuthError {
  return {
    code: "unsupported-browser",
    message:
      "This browser cannot coordinate account changes between tabs, so Livanta cannot open your account safely. Update your browser, or reload in a supported one.",
  };
}

/**
 * A teardown that re-establishes reminder ownership instead of only repeating
 * a cleanup. A failed ownership transition is not cleared by pressing retry:
 * the next attempt must again cancel and mark the current owner, so the block
 * cannot be lifted while the native reminder state is still unknown.
 */
function reminderOwnershipTeardown(ownerId: string | null): TeardownCallback {
  return async () => {
    let target = ownerId;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = await ensureReminderOwner({
        ownerId: target,
        confirmOwner: readSessionOwner,
      });
      if (outcome.status === "ready") return { ok: true };
      if (outcome.status === "failed") return { ok: false };
      // The session moved while this transition waited for the lock. Reconcile
      // against the session that is actually current, so the block cannot
      // outlive the account it was protecting.
      target = await readSessionOwner();
    }
    return { ok: false };
  };
}

/**
 * The retry operation for a block created by unavailable authentication.
 *
 * It repeats the unresolved transition: cancel everything and record no owner,
 * without needing to know which account last used this device. A session that
 * has become readable meanwhile is not a failure of this operation — that
 * account still has to pass its own activation barrier, which cancels before it
 * may be published.
 */
function unresolvedReminderTeardown(): TeardownCallback {
  return async () => {
    const outcome = await ensureReminderOwner({
      ownerId: null,
      confirmOwner: readSessionOwner,
      unresolved: true,
    });
    return outcome.status === "failed" ? { ok: false } : { ok: true };
  };
}

/**
 * Runs a teardown left over from a failed sign-out before any new session is
 * allowed to activate. Returns false when the account cannot be cleared, so
 * the caller must not sign in.
 *
 * Only one attempt runs at a time. Concurrent callers (a session event, a
 * retry button, a sign-in attempt) share the same result rather than each
 * asking the coordinator to tear the session down again.
 */
async function settlePendingTeardown(): Promise<boolean> {
  if (settlingTeardown) return settlingTeardown;

  // A block without a recorded operation is the fail-closed branch that ran
  // when no teardown was installed yet. Adopt the app root's teardown if it has
  // registered since; until one exists, stay blocked rather than publish over
  // an account that was never verified as torn down.
  if (!pendingTeardown && state.teardownPending) {
    if (!registeredSessionTeardown) return false;
    pendingTeardown = registeredSessionTeardown;
  }

  const teardown = pendingTeardown;
  if (!teardown) return true;

  emit({ error: null });
  const attempt = (async () => {
    let result: { ok: boolean } | void;
    try {
      result = await teardown();
    } catch {
      // A callback that throws is a failed teardown, not a reason to publish
      // the next account.
      result = { ok: false };
    }

    if (!teardownSucceeded(result)) {
      // Deliberately retained: every later session must pass through this
      // teardown before it can be published, and the retry path needs it.
      emit({ teardownPending: true, error: teardownFailure() });
      return false;
    }

    if (pendingTeardown === teardown) pendingTeardown = null;
    emit({ teardownPending: false, error: null });
    return true;
  })();

  settlingTeardown = attempt;
  void attempt.finally(() => {
    if (settlingTeardown === attempt) settlingTeardown = null;
  });
  return attempt;
}

/**
 * Replaces the state object rather than mutating it, which is what lets
 * useSyncExternalStore see a new reference and re-render.
 */
function emit(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

const getSnapshot = () => state;

/** The account this tab last published, even while a session read is loading. */
function currentActiveUserId(): string | null {
  if (activeUserId !== null) return activeUserId;
  return state.status === "signed-in" ? (state.user?.id ?? null) : null;
}

function publishSignedIn(session: Session): void {
  activeUserId = session.user.id;
  writePendingConfirmation(false);
  emit({
    user: session.user,
    status: "signed-in",
    needsEmailConfirmation: false,
    pendingEmail: null,
  });
}

/** Hides the outgoing account immediately; teardown still owns its resources. */
function beginSignedOut(): void {
  activeUserId = null;
  emit({ user: null, status: "signed-out" });
}

/**
 * Publishes the newest queued session only once any teardown has succeeded.
 *
 * A session for a different account is a switch: the previous account is
 * hidden and torn down first. A failed teardown leaves the newest session
 * queued, so repeated events cannot leak it into the UI, and a successful
 * retry can publish it without asking Supabase again.
 */
async function drainSessionQueue(): Promise<void> {
  while (queuedSession) {
    const next = queuedSession;
    const current = currentActiveUserId();

    if (current !== null && next.user.id !== current) {
      if (!pendingTeardown) {
        if (!registeredSessionTeardown) {
          // No teardown is installed, so activating another account would be
          // unverified. Fail closed instead of publishing over the old one.
          beginSignedOut();
          emit({ teardownPending: true, error: teardownFailure() });
          return;
        }
        pendingTeardown = registeredSessionTeardown;
      }
      beginSignedOut();
    }

    if (pendingTeardown) {
      // A failed settlement waits for the explicit retry button. Re-running it
      // on every duplicate auth event would hammer a failing native plugin.
      if (state.teardownPending) return;
      if (!(await settlePendingTeardown())) return;
      continue;
    }

    // A session that only refreshes the account already on screen is not a
    // handover: nothing on the device changed owner, so cancelling here would
    // wipe the plan the running app has already scheduled. The transition is
    // reserved for an account becoming visible for the first time in this tab.
    const alreadyPublished =
      current !== null && next.user.id === current && state.status === "signed-in";

    if (!alreadyPublished) {
      // Ownership is established before the account becomes visible, so the
      // native reminders that are still scheduled cannot belong to whoever used
      // this device last. A failure keeps the account queued and the app blocked.
      //
      // A launch that has not yet passed the entry choice cancels an armed plan
      // rather than adopting it. The account is authenticated, but a person
      // standing at the welcome screen has not chosen it, and notifications
      // scheduled by an earlier launch would otherwise reveal its records first.
      // A session exchanged from this launch's confirmation link has passed the
      // choice: the link is that proof, so its plan is adopted, not cancelled.
      const ownership = await ensureReminderOwner({
        ownerId: next.user.id,
        confirmOwner: readSessionOwner,
        cancelActivePlan:
          isEntryChoicePending() && !state.emailLinkAuthenticated,
      });
      if (ownership.status === "changed") {
        // A newer session replaced this one mid-transition. Re-read rather than
        // publish an account whose ownership could not be confirmed.
        queuedSession = null;
        void applySession();
        return;
      }
      if (ownership.status === "failed") {
        beginSignedOut();
        pendingTeardown = reminderOwnershipTeardown(next.user.id);
        emit({ teardownPending: true, error: teardownFailure() });
        return;
      }
    }

    queuedSession = null;
    publishSignedIn(next);
  }
}

/**
 * Proves that the session the client published is the one the confirmation
 * fragment carried. Anything else leaves the launch's normal entry flow in
 * place: a restored session, an unrelated account, or a fragment that failed
 * to exchange must not satisfy the introduction or account choice.
 */
function proveConfirmationLink(session: Session): void {
  if (confirmationLinkToken === null) return;
  if (session.access_token !== confirmationLinkToken) {
    confirmationLinkToken = null;
    return;
  }
  confirmationLinkToken = null;
  if (!state.emailLinkAuthenticated) emit({ emailLinkAuthenticated: true });
}

async function adoptSession(session: Session): Promise<void> {
  // An auth event must not publish an account when this tab cannot announce
  // the session to its siblings. Nothing is opened; retry re-checks.
  if (transportUnavailable()) {
    queuedSession = null;
    emit({ user: null, status: "error", error: unsupportedTransportError() });
    return;
  }

  proveConfirmationLink(session);
  queuedSession = session;
  if (drainingSessions) return drainingSessions;

  const drain = drainSessionQueue();
  drainingSessions = drain;
  try {
    await drain;
  } finally {
    if (drainingSessions === drain) drainingSessions = null;
  }
}

/**
 * Ends the published session. If the app root installed a teardown, it runs
 * before any queued session can activate — including a session produced by
 * another tab. The signed-out status is published first so the outgoing
 * account's records leave the screen while its store is being closed.
 */
async function endSession(): Promise<void> {
  // A session end is strictly newer than any session still waiting to be
  // published, so a queued session must not be activated later by a retry.
  queuedSession = null;

  const hadAccount = currentActiveUserId() !== null;
  activeUserId = null;

  if (hadAccount && !pendingTeardown && registeredSessionTeardown) {
    pendingTeardown = registeredSessionTeardown;
  }

  // A previous launch may have ended without finishing its reminder
  // transition. The signed-out app is not usable until this device proves its
  // native reminders no longer belong to anyone.
  if (!pendingTeardown) {
    let recoveryNeeded = true;
    try {
      recoveryNeeded = signedOutReminderRecoveryNeeded();
    } catch {
      // An unreadable marker is not evidence that the reminders are clean.
      recoveryNeeded = true;
    }
    if (recoveryNeeded) pendingTeardown = reminderOwnershipTeardown(null);
  }

  emit({
    user: null,
    status: "signed-out",
    emailLinkAuthenticated: false,
  });

  if (!pendingTeardown || state.teardownPending) return;
  await settlePendingTeardown();
}

/**
 * Blocks the app because the session could not be read, and makes sure no
 * account's reminders survive that block (ADR 0002 §5.3, cold start).
 *
 * The cancellation does not know which account scheduled the reminders, and
 * does not need to: it is unconditional, runs under the identity lock and
 * records `active` for no owner. If it cannot complete, the marker stays
 * `transitioning` and the app stays on the recovery surface with a retry.
 */
async function failClosedOnUnresolvedSession(attempt: number): Promise<void> {
  if (!sessionAttempts.current(attempt)) return;

  // A published account, or one waiting to be published, already owns the
  // reminders through its own barrier. A read that failed alongside it is not
  // authority to cancel that account's plan.
  if (state.status === "signed-in" || queuedSession !== null) return;

  emit({ user: null, status: "error" });

  const outcome = await ensureReminderOwner({
    ownerId: null,
    confirmOwner: readSessionOwner,
    unresolved: true,
    stillUnresolved: () =>
      state.status !== "signed-in" && queuedSession === null,
  });

  if (!sessionAttempts.current(attempt)) return;

  if (outcome.status === "changed") {
    // The authority answered after all. Reconcile with what it says instead of
    // leaving a block that describes an older failure.
    void applySession();
    return;
  }
  if (outcome.status === "ready") return;

  pendingTeardown = unresolvedReminderTeardown();
  emit({ teardownPending: true, error: teardownFailure() });
}

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
async function applySession(): Promise<void> {
  const attempt = sessionAttempts.begin();

  // Fail closed before reading the session: without a cross-tab transport an
  // account store may not be opened (ADR 0002 D5/B2.2). Beginning the attempt
  // first invalidates any read already in flight, so an older read cannot
  // publish over this block.
  if (transportUnavailable()) {
    emit({ user: null, status: "error", error: unsupportedTransportError() });
    return;
  }
  if (state.error?.code === "unsupported-browser") emit({ error: null });

  const supabase = getSupabase();
  if (!supabase) {
    await failClosedOnUnresolvedSession(attempt);
    return;
  }

  let session: Session | null;
  try {
    const { data, error } = await withTimeout(supabase.auth.getSession());
    if (error) throw error;
    session = data.session;
  } catch {
    await failClosedOnUnresolvedSession(attempt);
    return;
  }

  if (!sessionAttempts.current(attempt)) return;
  if (session) {
    await adoptSession(session);
  } else {
    await endSession();
  }
}

/**
 * Reads a failed confirmation or recovery redirect before supabase-js touches
 * the URL. Only an error fragment is cleared; a fragment carrying tokens is
 * never touched, so the client's own URL exchange still sees it.
 */
function readAndClearAuthLinkError(): AuthLinkError | null {
  if (typeof window === "undefined") return null;

  const error = parseAuthLinkError(window.location.hash);
  if (!error) return null;

  const url = new URL(window.location.href);
  url.hash = "";
  try {
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    /* The notice is still shown; only the address bar keeps the fragment. */
  }
  return error;
}

function start() {
  if (started) return;
  started = true;

  if (!isCloudEnabled()) return;

  // Read both fragments before supabase-js consumes the URL. An error is
  // cleared and explained; a confirmation token is left in place for the
  // client's single-use exchange and kept only for the comparison above.
  const linkError = readAndClearAuthLinkError();
  if (linkError) emit({ confirmationError: linkError });
  if (typeof window !== "undefined") {
    confirmationLinkToken = parseConfirmationLinkAccessToken(
      window.location.hash,
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    // The app cannot establish a session, so it blocks and cancels whatever
    // this device still holds. applySession owns that whole path, including the
    // error surface's retry.
    void applySession();
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

    // Every session, including one another tab announced, goes through the
    // queue. A session for a different account therefore cannot be published
    // until the previous account's teardown has succeeded.
    if (session) {
      void adoptSession(session);
    } else {
      void endSession();
    }

    // A recovery link establishes a real session, so `status` alone reads as an
    // ordinary sign-in and the app would show the signed-in screen instead of
    // asking for the new password the user came to set. Only this event arms the
    // reset flow, and nothing else disarms it: TOKEN_REFRESHED fires straight
    // afterwards and must not clear the flag out from under the form.
    if (event === "PASSWORD_RECOVERY") {
      emit({
        passwordResetReady: true,
        needsEmailConfirmation: false,
        pendingEmail: null,
      });
    }
  });

  void applySession();
}

async function retrySession(): Promise<void> {
  emit({ status: "loading", user: null });

  // A cold start whose session could not be read may also be holding a failed
  // reminder cancellation. Retry that first: a recovered session must not be
  // published until the device has proven the previous reminders are gone.
  if (!(await settlePendingTeardown())) {
    emit({ status: "error" });
    return;
  }

  await applySession();
}

/**
 * The reason a verification failed, mapped to the two explanations the entry
 * flow already has. GoTrue's message is never stored or rendered: it is
 * untrusted network text and can contain the address.
 */
function linkFailure(error: { code?: string; message?: string } | null): AuthLinkError {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  return code === "otp_expired" || /expired/i.test(message)
    ? "expired"
    : "invalid";
}

function failEmailLink(error: AuthLinkError): EmailLinkOutcome {
  emit({
    error: null,
    confirmationError: error,
    emailLinkAuthenticated: false,
    emailLinkVerifying: false,
    emailLinkAttempted: true,
  });
  return { ok: false, error };
}

/**
 * Reports a confirmation link that could not even be parsed. It still earns an
 * explanation on screen, but it can never earn the entry gate's proof.
 */
export function reportEmailLinkFailure(error: AuthLinkError = "invalid"): void {
  if (!isCloudEnabled()) return;
  start();
  failEmailLink(error);
}

/**
 * Exchanges an emailed token hash for a session.
 *
 * This is the native half of the flow: an App Link is verified here, in place,
 * so the token never becomes a WebView navigation. The input is checked again
 * at this boundary even though every caller parses it first. On success the
 * session's own auth event publishes it; awaiting that adoption lets the
 * caller render the destination with the account already settled. On failure
 * only the translated reason is kept, and the entry gate stays closed.
 *
 * `emailLinkAuthenticated` is set only after Supabase accepts the token. A
 * restored session seen during the exchange is therefore treated as an
 * ordinary session and its armed reminders are cancelled, not adopted; the
 * verified account's plan is reconciled once the app opens.
 */
export async function verifyEmailLinkToken(
  link: TokenHashLink,
): Promise<EmailLinkOutcome> {
  if (!isCloudEnabled()) return { ok: false, error: "invalid" };
  if (!isTokenHashLink(link)) {
    start();
    return failEmailLink("invalid");
  }

  // The subscription and session read exist before the exchange, so the
  // session Supabase publishes has somewhere to land.
  start();
  confirmationLinkToken = null;
  emit({
    error: null,
    confirmationError: null,
    emailLinkAuthenticated: false,
    emailLinkVerifying: true,
    emailLinkAttempted: true,
  });

  const supabase = getSupabase();
  if (!supabase) return failEmailLink("invalid");

  let outcome: EmailLinkOutcome;
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: link.tokenHash,
      type: link.type,
    });
    if (error || !data.session) {
      return failEmailLink(linkFailure(error));
    }

    // Supabase has already announced this session. Awaiting the same adoption
    // is idempotent and makes success mean "the account is ready", not merely
    // "the network call returned".
    await adoptSession(data.session);

    writePendingConfirmation(false);
    emit({
      emailLinkAuthenticated: true,
      emailLinkVerifying: false,
      confirmationError: null,
      needsEmailConfirmation: false,
      pendingEmail: null,
      ...(link.type === "recovery" ? { passwordResetReady: true } : {}),
    });
    outcome = { ok: true, type: link.type };
  } catch {
    // A thrown fetch or storage failure is not evidence that the token was
    // good, so the gate stays closed and the user sees the ordinary failure.
    outcome = failEmailLink("invalid");
  }
  return outcome;
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
    emit({ error: null, confirmationError: null });
    if (!(await settlePendingTeardown())) return false;
    const supabase = getSupabase();
    if (!supabase) return false;

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      const mapped = toAuthError(signInError);
      if (mapped.code === "email-unconfirmed") {
        // The address exists but is unconfirmed. That is the pending screen's
        // job, not a generic failure: nothing was sent by this attempt, so the
        // prompt offers a resend rather than claiming one.
        const pending = email.trim();
        writePendingConfirmation(true, pending);
        emit({
          error: null,
          needsEmailConfirmation: true,
          pendingEmail: pending,
        });
        return false;
      }
      emit({ error: mapped });
      return false;
    }
    writePendingConfirmation(false);
    emit({ needsEmailConfirmation: false, pendingEmail: null });
    return true;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string): Promise<SignUpOutcome> => {
      emit({ error: null, needsEmailConfirmation: false, confirmationError: null });
      if (!(await settlePendingTeardown())) return { ok: false };
      const supabase = getSupabase();
      if (!supabase) return { ok: false };

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // Without this GoTrue uses the project-wide Site URL, which is wrong
        // for every environment except the one it was last set to. The
        // resolver prefers a configured public origin and never lets a
        // production build email a localhost address.
        options: {
          // The confirmation route owns both link styles: a token hash for the
          // email template, and the implicit fragment if the project is still
          // on Supabase's default template.
          emailRedirectTo: authRedirectUrl(
            window.location.origin,
            AUTH_CONFIRM_PATH,
          ),
        },
      });
      if (signUpError) {
        emit({ error: toAuthError(signUpError) });
        return { ok: false };
      }
      // When email confirmation is switched on in the Supabase project there is
      // no session yet. Say so, and keep saying so across reloads, otherwise the
      // only signal is a toast that disappears before the user can act on it.
      const needsEmailConfirmation = !data.session && Boolean(data.user);
      const pendingEmail = needsEmailConfirmation ? email.trim() : null;
      /* GoTrue answers a duplicate sign-up with a user whose identities are
         empty when it does not want to reveal that the address exists. Only a
         real new registration carries an identity, so only that result may
         seed a local profile. */
      const newAccount = Boolean(
        data.user && Array.isArray(data.user.identities) && data.user.identities.length > 0,
      );
      writePendingConfirmation(needsEmailConfirmation, pendingEmail ?? undefined);
      emit({ needsEmailConfirmation, pendingEmail });
      return {
        ok: true,
        needsEmailConfirmation,
        userId: data.user?.id,
        newAccount,
      };
    },
    [],
  );

  const resendConfirmation = useCallback(
    async (email: string): Promise<ResendOutcome> => {
      const address = email.trim();
      const supabase = getSupabase();
      if (!address || !supabase) {
        return {
          ok: false,
          error: { code: "unknown", message: "confirmation email unavailable" },
        };
      }

      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: address,
        options: {
          emailRedirectTo: authRedirectUrl(
            window.location.origin,
            AUTH_CONFIRM_PATH,
          ),
        },
      });
      // Success is Supabase accepting the request. Whether GoTrue actually
      // mails an existing unconfirmed address is its own decision, and its
      // answer is deliberately indistinguishable from a fresh sign-up.
      if (resendError) return { ok: false, error: toAuthError(resendError) };
      return { ok: true };
    },
    [],
  );

  const clearPendingConfirmation = useCallback(() => {
    writePendingConfirmation(false);
    emit({ needsEmailConfirmation: false, pendingEmail: null });
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    emit({ error: null, confirmationError: null });
    const supabase = getSupabase();
    if (!supabase) return false;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      // Supabase appends the token to this and redirects back into the app.
      {
        redirectTo: authRedirectUrl(
          window.location.origin,
          AUTH_CONFIRM_PATH,
        ),
      },
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

  const signOut = useCallback(async (onSignedOut?: TeardownCallback) => {
    // A session read that was already in flight is older than this sign-out
    // attempt and must not restore the session after it completes.
    sessionAttempts.invalidate();
    emit({ error: null });
    const supabase = getSupabase();
    const result = await performSignOut(supabase);
    if (!result.ok) {
      // Re-sync with Supabase's actual session state: the local session may
      // have been cleared even when the remote sign-out failed, so we must not
      // claim the user is still signed in when Supabase disagrees.
      await retrySession();
      emit({
        error: { code: "sign-out-failed", message: result.message },
      });
      return;
    }

    writePendingConfirmation(false);
    // Record the teardown before publishing the signed-out status. An already
    // pending teardown wins: it belongs to an account whose resources are still
    // held, and replacing it with this call's callback would lose that work.
    // The app root's registered teardown is the fallback when a caller passes
    // none, so an expiry arriving later still has one to run.
    if (!pendingTeardown) {
      pendingTeardown = onSignedOut ?? registeredSessionTeardown ?? null;
    }
    // The remote session is gone, so publish that before local teardown: no
    // surface may keep showing the old account while its store is closed.
    // `teardownPending` is deliberately left alone: an earlier failure stays
    // blocking until settlement actually succeeds.
    activeUserId = null;
    confirmationLinkToken = null;
    emit({
      user: null,
      status: "signed-out",
      needsEmailConfirmation: false,
      pendingEmail: null,
      confirmationError: null,
      emailLinkAuthenticated: false,
      emailLinkVerifying: false,
      emailLinkAttempted: false,
      passwordResetReady: false,
    });

    if (pendingTeardown) await settlePendingTeardown();
  }, []);

  const retryTransition = useCallback(async () => {
    // Run the failed teardown first; nothing may activate until it succeeds.
    if (!(await settlePendingTeardown())) return;

    // A session that arrived while teardown was failing is still waiting. It
    // was accepted by Supabase already, so publishing it needs no new read and
    // cannot be used to skip the teardown that just completed.
    if (queuedSession) {
      await adoptSession(queuedSession);
      return;
    }

    // Otherwise reconcile with Supabase so the surface reflects the real
    // session after recovery.
    await retrySession();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    emit({ error: null, confirmationError: null });
    if (!(await settlePendingTeardown())) return false;
    const supabase = getSupabase();
    if (!supabase) return false;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl(
          window.location.origin,
          window.location.pathname,
        ),
      },
    });
    if (error) {
      emit({ error: toAuthError(error) });
      return false;
    }
    return true;
  }, []);

  const signInWithApple = useCallback(async () => {
    emit({ error: null, confirmationError: null });
    if (!(await settlePendingTeardown())) return false;
    const supabase = getSupabase();
    if (!supabase) return false;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: authRedirectUrl(
          window.location.origin,
          window.location.pathname,
        ),
      },
    });
    if (error) {
      emit({ error: toAuthError(error) });
      return false;
    }
    return true;
  }, []);

  const clearError = useCallback(() => emit({ error: null }), []);
  const clearConfirmationError = useCallback(
    () => emit({ confirmationError: null }),
    [],
  );

  return {
    enabled,
    status: session.status,
    user: session.user,
    error: session.error,
    needsEmailConfirmation: session.needsEmailConfirmation,
    pendingEmail: session.pendingEmail,
    confirmationError: session.confirmationError,
    emailLinkAuthenticated: session.emailLinkAuthenticated,
    emailLinkVerifying: session.emailLinkVerifying,
    emailLinkAttempted: session.emailLinkAttempted,
    passwordResetReady: session.passwordResetReady,
    signIn,
    signUp,
    resendConfirmation,
    clearPendingConfirmation,
    resetPassword,
    updatePassword,
    cancelPasswordReset,
    signOut,
    teardownPending: session.teardownPending,
    retryTransition,
    clearError,
    clearConfirmationError,
    retrySession,
    signInWithGoogle,
    signInWithApple,
  };
}

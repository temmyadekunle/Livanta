/**
 * Coordinates an account's teardown across the app's auth lifecycle.
 *
 * The app learns about a sign-out from two places: the sign-out callback it
 * hands to `useAuth`, and the auth-status edge that a Supabase-initiated
 * session expiry produces. Both must run exactly one teardown for the session
 * that ended, and neither may suppress the other — a failed or completed
 * attempt for one session must not stop the next session from being torn down.
 *
 * The coordinator therefore works per session ("epoch"):
 *
 * - Every new signed-in session starts a new epoch. Re-signing in as the same
 *   account is still a new session, because its store is new.
 * - The first teardown request for an epoch runs; later requests for the same
 *   epoch share its promise instead of tearing down twice.
 * - A failed teardown can be retried. A successful one is final for the epoch.
 * - State is never keyed by a mutable "already signed out" latch, so a later
 *   session expiry always has a fresh lifecycle to tear down.
 *
 * This module holds no React state and touches no storage, so the lifecycle
 * can be tested directly.
 */
import type { LocalStore } from "./db.ts";
import {
  teardownAccount,
  transitionIdentity,
  type IdentityReason,
  type TeardownResult,
} from "./identityTransition.ts";

export interface AccountTransitionDeps {
  /**
   * Performs the teardown. `broadcast` is false when the transition was learned
   * from another tab: rebroadcasting it would echo the message back and forth.
   */
  transition(
    store: LocalStore | null,
    userId: string,
    reason: IdentityReason,
    broadcast: boolean,
  ): Promise<TeardownResult>;
}

export interface AccountTransitionCoordinator {
  /** Records the account this tab is displaying. Call for every signed-in render. */
  signedIn(userId: string, store: LocalStore | null): void;
  /**
   * Tears down the current session at most once. Duplicate requests for the
   * same session return the same operation; a failed operation may be retried.
   */
  signOut(
    reason: IdentityReason,
    options?: { broadcast?: boolean },
  ): Promise<TeardownResult>;
  /** The account this tab is displaying, or null when no session was recorded. */
  currentUserId(): string | null;
  /** The store recorded for the current session. */
  currentStore(): LocalStore | null;
}

interface Session {
  userId: string;
  store: LocalStore | null;
  epoch: number;
}

interface Held {
  epoch: number;
  promise: Promise<TeardownResult>;
  failed: boolean;
}

export function createAccountTransitionCoordinator(
  deps: AccountTransitionDeps = {
    transition: (store, userId, reason, broadcast) =>
      broadcast
        ? transitionIdentity(store, userId, reason)
        : teardownAccount(store, userId),
  },
): AccountTransitionCoordinator {
  let session: Session | null = null;
  let epochCounter = 0;
  let held: Held | null = null;
  let endedFor: number | null = null;

  return {
    signedIn(userId, store) {
      if (!session || session.userId !== userId || endedFor === session.epoch) {
        epochCounter += 1;
        session = { userId, store, epoch: epochCounter };
        held = null;
        endedFor = null;
        return;
      }
      session.store = store;
    },

    signOut(reason, options) {
      if (!session) return Promise.resolve({ ok: true });
      if (endedFor === session.epoch) return Promise.resolve({ ok: true });
      if (held && held.epoch === session.epoch && !held.failed) {
        return held.promise;
      }

      const epoch = session.epoch;
      const store = session.store;
      const userId = session.userId;
      const broadcast = options?.broadcast ?? true;

      const promise = deps
        .transition(store, userId, reason, broadcast)
        .then(
          (result) => {
            if (result.ok) endedFor = epoch;
            return result;
          },
          (error: unknown) => ({
            ok: false as const,
            reason: `Teardown failed: ${error instanceof Error ? error.message : String(error)}`,
          }),
        );

      const record: Held = { epoch, promise, failed: false };
      held = record;
      void promise.then((result) => {
        record.failed = !result.ok;
      });
      return promise;
    },

    currentUserId() {
      return session?.userId ?? null;
    },

    currentStore() {
      return session?.store ?? null;
    },
  };
}

/**
 * The coordinator used by the running app.
 *
 * It deliberately lives outside React: the component that owns view state is
 * remounted when the auth status changes, and a coordinator created inside it
 * would die at exactly the moment a transition begins. `AppEntry` and
 * `LivantaApp` therefore share this one instance, and its session record
 * survives the remount they perform.
 */
let shared: AccountTransitionCoordinator | null = null;

export function getAccountTransitionCoordinator(): AccountTransitionCoordinator {
  if (!shared) shared = createAccountTransitionCoordinator();
  return shared;
}

/** Discards the shared coordinator and its recorded session, for tests. */
export function resetAccountTransitionForTesting(): void {
  shared = null;
}

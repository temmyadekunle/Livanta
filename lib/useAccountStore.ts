"use client";

import { useMemo } from "react";

import { anonymousStore, createLocalStore, type LocalStore } from "./db.ts";
import {
  resolveLocalScope,
  type LocalScopeErrorReason,
  type LocalScopeResolution,
} from "./localScope.ts";
import type { AuthStatus } from "./useAuth.ts";

export interface UseAccountStoreInput {
  /** Whether this build has cloud authentication configured. */
  readonly authEnabled: boolean;
  readonly authStatus: AuthStatus;
  /** The signed-in user id, if there is one. */
  readonly userId: string | null;
  /**
   * Bumped to replace the store with a fresh one for the same account, e.g.
   * after another tab revoked this tab's store during an identity transition.
   */
  readonly resetToken?: number;
}

export interface UseAccountStoreOutput {
  /** The store this surface may read, or null when none may be opened. */
  readonly store: LocalStore | null;
  /** The normalised owner the store must belong to, or null. */
  readonly expectedUserId: string | null;
  /** The resolver's decision, for the app-surface decision. */
  readonly status: LocalScopeResolution["status"];
  /** Why no account store could be resolved, when applicable. */
  readonly errorReason: LocalScopeErrorReason | null;
}

/**
 * Resolves the authenticated user's account store.
 *
 * The identity decision itself lives in `resolveLocalScope`, so the app has one
 * definition of when a store may exist. No component constructs an account
 * store or derives an expected owner independently.
 *
 * An account store is created only for a signed-in session with a valid
 * Supabase UUID. Loading, signed-out, failed and malformed sessions return a
 * null store: no database is opened and no anonymous fallback is used. The one
 * anonymous store that can be returned is the explicitly auth-disabled
 * development configuration, which `resolveLocalScope` owns and production
 * builds cannot reach.
 *
 * The store is memoised on the resolved scope (and the reset token) so that
 * `useLivanta`'s hydrate effect does not re-run on every render, while a
 * revoked or replaced store is never reused.
 */
export function useAccountStore({
  authEnabled,
  authStatus,
  userId,
  resetToken = 0,
}: UseAccountStoreInput): UseAccountStoreOutput {
  const resolution = useMemo(
    () => resolveLocalScope({ enabled: authEnabled, status: authStatus, userId }),
    [authEnabled, authStatus, userId],
  );

  const store = useMemo(() => {
    if (resolution.status === "account") {
      return createLocalStore(resolution.scope);
    }
    if (resolution.status === "anonymous") {
      return anonymousStore;
    }
    return null;
    // `resetToken` is a cache-buster, not an input: teardown evicted the old
    // handle, so a new memo run must recreate the store for the same account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution, resetToken]);

  return {
    store,
    expectedUserId:
      resolution.status === "account" && resolution.scope.kind === "user"
        ? resolution.scope.userId
        : null,
    status: resolution.status,
    errorReason: resolution.status === "error" ? resolution.reason : null,
  };
}

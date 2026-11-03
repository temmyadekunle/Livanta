/**
 * Resolves the local-storage scope from an authentication snapshot.
 *
 * This module is deliberately pure: it never opens IndexedDB, reads records,
 * touches sync metadata or claims ownership. Loading states and malformed
 * sessions are reported explicitly rather than being folded into the anonymous
 * scope, so a caller cannot accidentally expose device data to an account.
 */

import {
  anonymousScope,
  isValidUserId,
  userScope,
  type LocalScope,
} from "./db.ts";
import type { AuthStatus } from "./useAuth.ts";

export interface AuthScopeInput {
  /** Whether this build has cloud authentication configured. */
  enabled: boolean;
  status: AuthStatus;
  /** The signed-in user id, if there is one. */
  userId?: string | null;
}

export type LocalScopeErrorReason = "invalid-user" | "unknown-auth-status";

export type LocalScopeResolution =
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly reason: LocalScopeErrorReason }
  | { readonly status: "anonymous"; readonly scope: LocalScope }
  | { readonly status: "account"; readonly scope: LocalScope };

export function resolveLocalScope(input: AuthScopeInput): LocalScopeResolution {
  if (!input.enabled) {
    return { status: "anonymous", scope: anonymousScope() };
  }

  switch (input.status) {
    case "disabled":
      return { status: "anonymous", scope: anonymousScope() };
    case "loading":
      return { status: "pending" };
    case "signed-out":
      return { status: "anonymous", scope: anonymousScope() };
    case "signed-in":
      if (!isValidUserId(input.userId)) {
        return { status: "error", reason: "invalid-user" };
      }
      return { status: "account", scope: userScope(input.userId) };
    default:
      return { status: "error", reason: "unknown-auth-status" };
  }
}

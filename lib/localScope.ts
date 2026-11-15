/**
 * Resolves the local-storage scope from an authentication snapshot.
 *
 * This module is deliberately pure: it never opens IndexedDB, reads records,
 * touches sync metadata or claims ownership. Loading, signed-out, failed and
 * malformed sessions are reported explicitly rather than being folded into the
 * anonymous scope, so a caller cannot accidentally expose device data to an
 * account. Anonymous access exists only when authentication is explicitly
 * disabled for a development build.
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

export type LocalScopeErrorReason =
  | "invalid-user"
  | "auth-error"
  | "auth-disabled-conflict"
  | "unknown-auth-status";

export type LocalScopeResolution =
  | { readonly status: "pending" }
  | { readonly status: "unavailable" }
  | { readonly status: "error"; readonly reason: LocalScopeErrorReason }
  | { readonly status: "anonymous"; readonly scope: LocalScope }
  | { readonly status: "account"; readonly scope: LocalScope };

export function resolveLocalScope(input: AuthScopeInput): LocalScopeResolution {
  // The only anonymous path. A build with cloud authentication explicitly
  // absent is the documented development/test configuration (D4); production
  // builds fail closed without usable Supabase configuration, so this branch
  // is unreachable there.
  if (!input.enabled) {
    return { status: "anonymous", scope: anonymousScope() };
  }

  switch (input.status) {
    case "loading":
      return { status: "pending" };
    case "signed-out":
      // B1 fail-closed: a signed-out session has no local scope. It is not
      // permission to read the anonymous database.
      return { status: "unavailable" };
    case "error":
      return { status: "error", reason: "auth-error" };
    case "disabled":
      // Contradictory: authentication is enabled but reports itself
      // disabled. Never fall through to anonymous data on an inconsistent
      // state.
      return { status: "error", reason: "auth-disabled-conflict" };
    case "signed-in":
      if (!isValidUserId(input.userId)) {
        return { status: "error", reason: "invalid-user" };
      }
      return { status: "account", scope: userScope(input.userId) };
    default:
      return { status: "error", reason: "unknown-auth-status" };
  }
}

/**
 * Decides whether a sync cycle may run.
 *
 * Suspension is explicit: an auth state that is still resolving, a signed-out
 * session, or a missing/foreign account store all stop sync before it can touch
 * IndexedDB or the network. In particular, none of them selects the anonymous
 * database as a fallback.
 */

import { databaseNameForScope, isValidUserId, LocalStore } from "../db.ts";
import type { AuthStatus } from "../useAuth.ts";
import { syncOwner, type SyncOwner } from "./meta.ts";

export type SyncSuspensionReason =
  | "sync-disabled"
  | "auth-pending"
  | "signed-out"
  | "unresolved-session"
  | "store-unavailable"
  | "store-mismatch";

export type SyncSuspension =
  | { readonly suspended: true; readonly reason: SyncSuspensionReason }
  | { readonly suspended: false; readonly owner: SyncOwner };

export interface SyncSuspensionInput {
  /** Whether this build has cloud authentication configured. */
  enabled: boolean;
  status: AuthStatus;
  userId?: string | null;
  /** The account store the app is currently displaying, if one is ready. */
  store?: LocalStore | null;
}

export function resolveSyncSuspension(
  input: SyncSuspensionInput,
): SyncSuspension {
  if (!input.enabled) return { suspended: true, reason: "sync-disabled" };

  switch (input.status) {
    case "disabled":
      return { suspended: true, reason: "sync-disabled" };
    case "loading":
      return { suspended: true, reason: "auth-pending" };
    case "signed-out":
      return { suspended: true, reason: "signed-out" };
    case "signed-in":
      break;
    default:
      return { suspended: true, reason: "unresolved-session" };
  }

  if (!isValidUserId(input.userId)) {
    return { suspended: true, reason: "unresolved-session" };
  }
  const owner = syncOwner(input.userId);

  const store = input.store;
  if (!(store instanceof LocalStore)) {
    return { suspended: true, reason: "store-unavailable" };
  }
  const scope = store.scope;
  if (
    scope.kind !== "user" ||
    store.databaseName !== databaseNameForScope(scope) ||
    scope.userId !== owner.userId
  ) {
    return { suspended: true, reason: "store-mismatch" };
  }

  return { suspended: false, owner };
}

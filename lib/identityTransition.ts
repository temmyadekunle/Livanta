/**
 * Cross-tab identity transitions.
 *
 * When one tab signs out or switches accounts, every other tab must stop
 * showing that account's records and close its store. A Web Lock serialises
 * transitions so two tabs cannot tear down and rebuild stores at the same time,
 * and the identity transport (BroadcastChannel, with a storage-event fallback)
 * tells every open tab that the session may have changed.
 *
 * The lock is mandatory: if Web Locks are unavailable the transition aborts
 * rather than proceeding without coordination. Lock acquisition is bounded by a
 * timeout so a frozen tab cannot block identity transitions indefinitely.
 */

import { type LocalStore } from "./db.ts";
import { releaseSyncOwner, syncOwner, type SyncOwner } from "./sync/meta.ts";
import { withIdentityLock } from "./identityLock.ts";
import { cancelForTransition } from "./reminders/coordinator.ts";
import {
  beginReminderTransition,
  completeReminderTransition,
} from "./reminders/ownerMarker.ts";
import {
  broadcastIdentityChange,
  resetIdentityTransportForTesting,
  type IdentityReason,
} from "./identityTransport.ts";

export type { IdentityMessage, IdentityReason } from "./identityTransport.ts";
export {
  subscribeToIdentityChanges,
  broadcastIdentityChange,
} from "./identityTransport.ts";

export type TeardownResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Reset the active transport for testing. */
export function resetIdentityChannelForTesting(): void {
  resetIdentityTransportForTesting();
}

/**
 * Tears down one account's local presence: cancels its scheduled reminders,
 * closes its IndexedDB store and releases the sync owner binding — all within
 * the identity-transition coordination boundary.
 *
 * Order matters. The persisted marker is set `transitioning` first, then
 * reminders are cancelled, so a process death anywhere in this operation is
 * recoverable on the next launch. A cancellation failure leaves the marker
 * `transitioning` and the account's store and binding untouched, so the caller
 * can keep the user signed in without a half-torn-down account. Only once
 * cancellation has succeeded is the store closed, the binding released and the
 * marker completed; and because the cancellation is queued behind any
 * scheduling already in progress, no reminder from this account can be
 * recreated after it.
 *
 * The store must belong to the account being torn down. A mismatched pair is
 * refused rather than closing a store the caller did not mean to release.
 */
export async function teardownAccount(
  store: LocalStore | null,
  userId: string | null,
): Promise<TeardownResult> {
  if (store) {
    if (!userId) {
      return {
        ok: false,
        reason: "A store can only be torn down for an identified account.",
      };
    }
    if (
      store.scope.kind !== "user" ||
      store.scope.userId !== userId.toLowerCase()
    ) {
      return {
        ok: false,
        reason: "The store belongs to a different account than the one being torn down.",
      };
    }
  }

  let owner: SyncOwner | null = null;
  if (userId) {
    try {
      owner = syncOwner(userId);
    } catch {
      return {
        ok: false,
        reason: "The account id is not a valid identity to tear down.",
      };
    }
  }

  try {
    await withIdentityLock(async () => {
      // The marker records the unfinished transition before anything is
      // cancelled, so a reload or restart mid-teardown recovers instead of
      // trusting an unknown native reminder state.
      const transition = beginReminderTransition(null);
      // Cancellation happens inside the coordination boundary so that no other
      // account can activate before this account's reminders are gone.
      await cancelForTransition(transition);
      if (store) {
        await store.close();
      }
      if (owner) {
        releaseSyncOwner(owner);
      }
      completeReminderTransition(transition);
    });
  } catch (e) {
    return {
      ok: false,
      reason: `Local teardown failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return { ok: true };
}

/**
 * Runs a full identity transition: tears down the previous account's local
 * presence, then tells every other tab to reconcile with the session.
 *
 * If teardown fails (e.g. reminder cancellation), no signal is sent and the
 * failure result is returned so the caller can keep the authenticated state.
 * If no transport can deliver the signal, the transition also reports failure:
 * the app must stay blocked rather than assume other tabs were told.
 *
 * The caller is responsible for opening the new store and re-hydrating after
 * this returns successfully.
 */
export async function transitionIdentity(
  previousStore: LocalStore | null,
  previousUserId: string | null,
  reason: IdentityReason,
): Promise<TeardownResult> {
  const result = await teardownAccount(previousStore, previousUserId);
  if (!result.ok) {
    return result;
  }
  try {
    broadcastIdentityChange(reason);
  } catch (error) {
    return {
      ok: false,
      reason: `The identity change could not be communicated to other tabs: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return { ok: true };
}

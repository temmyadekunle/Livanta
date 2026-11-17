/**
 * The single reminder-ownership transition.
 *
 * Every path that ends one reminder owner and establishes another — explicit
 * sign-out, session expiry, account switch, cold start and retry — runs this
 * one operation. Under `livanta:identity-and-reminders:v1` it:
 *
 * 1. re-reads the authoritative session and refuses to continue if the target
 *    changed (the caller re-runs for the newest target);
 * 2. writes `transitioning` for the target, so a crash from this point on is
 *    recoverable rather than silently skipped;
 * 3. cancels every native reminder unconditionally, and treats any throw as a
 *    failure;
 * 4. writes `active` for the same epoch and transition id.
 *
 * Nothing activates and nothing schedules until this returns `ready`. A failed
 * attempt leaves the marker `transitioning`, which is what makes the next
 * launch recover instead of trusting an unknown reminder state.
 *
 * A session restored before this launch's authentication choice is owned but
 * suspended: the transition still confirms the session, cancels the plan that
 * a previous launch left armed, and records `active` for the same owner. The
 * account's records keep their scheduling information; the app schedules the
 * plan again only after the user chooses and the account surface is ready.
 *
 * A cold start whose session cannot be read at all has no target to compare
 * against. In that case (`unresolved: true`) the same transition runs for the
 * only owner the device can prove — none — because cancellation is
 * unconditional and does not need the previous account's id.
 */

import { withIdentityLock } from "../identityLock.ts";
import { cancelForTransition } from "./coordinator.ts";
import {
  beginReminderTransition,
  completeReminderTransition,
  readReminderMarker,
  reminderOwnerHash,
  ReminderMarkerChangedError,
  ReminderOwnerUnavailableError,
} from "./ownerMarker.ts";

export type ReminderOwnerOutcome =
  | { readonly status: "ready" }
  | { readonly status: "changed" }
  | { readonly status: "failed"; readonly reason: string };

export interface EnsureReminderOwnerInput {
  /** The account whose ownership is being established; null for signed out. */
  readonly ownerId: string | null;
  /**
   * Reads the session again from the authority. Returning a different id
   * aborts this transition; the caller restarts with the newest target.
   */
  readonly confirmOwner: () => Promise<string | null>;
  /**
   * Cancel an already-adopted plan instead of adopting it.
   *
   * The entry flow sets this for a session restored before this launch's
   * authentication choice. Ownership is still the same account, so the marker
   * is left active for it; only the native alarms are dropped. That is what
   * stops account titles appearing in notifications behind the welcome screen,
   * and the next reconciliation for the account reschedules the full plan.
   */
  readonly cancelActivePlan?: boolean;
  /**
   * Fail-closed mode for an unavailable authority (ADR 0002 §5.3 cold start).
   * When the session cannot be read, the transition still cancels every
   * reminder and records `active` for no owner. This needs no knowledge of
   * which account scheduled them: cancellation is unconditional, and `null` is
   * the only owner that can be proven when nobody can be identified.
   */
  readonly unresolved?: boolean;
  /**
   * Consulted under the lock after `confirmOwner` failed in unresolved mode.
   * Returning false aborts the cancellation because an account became visible
   * while the read was failing; that account now owns the reminders and its own
   * activation barrier decides what happens next.
   */
  readonly stillUnresolved?: () => boolean;
}

class OwnerChanged extends Error {
  constructor() {
    super("The session changed during the reminder transition.");
    this.name = "OwnerChanged";
  }
}

/**
 * Persisted state that still needs recovery on a signed-out cold start.
 *
 * Only an `active` marker for no owner proves the device has no reminders to
 * reconcile. An absent or corrupt marker is unproven, not clean (ADR 0002
 * §5.3), so it takes the same cancellation path before the gate is trusted.
 */
export function signedOutReminderRecoveryNeeded(): boolean {
  const marker = readReminderMarker();
  return !(marker?.phase === "active" && marker.owner === null);
}

/**
 * Establishes `ownerId` as the reminder owner, or reports why it could not.
 *
 * A marker that is already `active` for the target is adopted without
 * cancelling (ADR 0002 §5.2 step 5). The session was just re-read under the
 * lock and the marker's owner hash matches it, so cancellation has already
 * been completed by whichever transition wrote it; the caller's
 * reconciliation still cancels and reschedules the full plan before relying on
 * the native state.
 */
export async function ensureReminderOwner(
  input: EnsureReminderOwnerInput,
): Promise<ReminderOwnerOutcome> {
  try {
    await withIdentityLock(async () => {
      let confirmed: string | null;
      try {
        confirmed = await input.confirmOwner();
      } catch (error) {
        if (!input.unresolved) throw error;
        if (input.stillUnresolved && !input.stillUnresolved()) {
          throw new OwnerChanged();
        }
        // The authority is unavailable, so no account can be proven. `null`
        // makes the transition cancel unconditionally and record a state that
        // proves the device holds no owner's reminders.
        confirmed = input.ownerId;
      }
      if (confirmed !== input.ownerId) throw new OwnerChanged();

      const target =
        input.ownerId === null
          ? null
          : await reminderOwnerHash(input.ownerId);

      // Step 5: another tab (or an earlier activation) already completed the
      // cancellation for this owner, and the session still names it. Adopting
      // the marker avoids wiping a plan that is about to be reconciled anyway.
      // The entry gate refuses that adoption until this launch's choice is
      // made, because the plan is visible on the device before the account is.
      const marker = readReminderMarker();
      if (
        !input.cancelActivePlan &&
        marker?.phase === "active" &&
        marker.owner === target
      ) {
        return;
      }

      const transition = beginReminderTransition(target);
      await cancelForTransition(transition);
      completeReminderTransition(transition);
    });
    return { status: "ready" };
  } catch (error) {
    if (error instanceof OwnerChanged) return { status: "changed" };
    return { status: "failed", reason: failureReason(error) };
  }
}

function failureReason(error: unknown): string {
  if (
    error instanceof ReminderOwnerUnavailableError ||
    error instanceof ReminderMarkerChangedError
  ) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "The reminder transition could not be completed.";
}

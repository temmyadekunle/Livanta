/**
 * The one reminder coordinator (ADR 0002 §5.2 steps 7 and 10, §5.3).
 *
 * Native reminders outlive the tab that scheduled them and the account that
 * owns them, so every native `cancelAll`/`schedule` call and every in-session
 * `new Notification` delivery is made here, and nowhere else.
 *
 * Under `livanta:identity-and-reminders:v1` the coordinator:
 *
 * 1. re-reads the session from the authority;
 * 2. rejects a plan or notification whose owner is not that session owner;
 * 3. checks the persisted owner marker, including its transition id;
 * 4. performs the side effect;
 * 5. re-reads the marker and, if the epoch or transition id moved, cancels
 *    again so the last thing the plugin heard is a full cancellation.
 *
 * Reconciliation is always a full cancellation followed by the full plan of the
 * target owner (ADR 0002 §5.2 step 10); it is never a differential add/remove.
 * When any check fails, nothing is scheduled: a stale tab cannot recreate a
 * previous account's reminders, and a plan that cannot prove its owner is
 * dropped rather than applied.
 */

import { withIdentityLock } from "../identityLock.ts";
import {
  cancelScheduledReminders,
  prepareReminderScheduling,
  scheduleReminders,
  type ScheduleResult,
} from "../schedule.ts";
import { readSessionOwner } from "../sessionAuthority.ts";
import type { PlannedReminder } from "../reminders.ts";
import { showNotification } from "../notifications.ts";
import {
  readReminderMarker,
  reminderOwnerHash,
  type ReminderMarker,
} from "./ownerMarker.ts";

/** The marker changed while a transition was applying its side effect. */
export class ReminderTransitionChangedError extends Error {
  constructor() {
    super("The reminder transition changed before it could complete.");
    this.name = "ReminderTransitionChangedError";
  }
}

interface Fence {
  readonly epoch: number;
  readonly tid: string;
}

function matchesFence(marker: ReminderMarker | null, fence: Fence): boolean {
  return marker?.epoch === fence.epoch && marker?.tid === fence.tid;
}

/** Test seam: replaces the authoritative session read. Pass null to restore. */
let sessionReaderOverride: (() => Promise<string | null>) | null = null;

export function setReminderSessionReaderForTesting(
  reader: (() => Promise<string | null>) | null,
): void {
  sessionReaderOverride = reader;
}

function readOwner(): Promise<string | null> {
  return (sessionReaderOverride ?? readSessionOwner)();
}

/**
 * Cancels every native reminder for the transition that wrote `transition`
 * (ADR 0002 §5.2 step 7). Called while holding the identity lock.
 *
 * The transition id check before the native call is what stops a completion
 * that belongs to a replaced transition. The re-read afterwards implements the
 * "if the epoch or tid changed, cancel again" rule: if some other writer did
 * move the marker, this cancellation still has the last word.
 *
 * A failed cancellation propagates as ReminderCancellationError, leaving the
 * caller's `transitioning` marker in place so the next launch retries.
 */
export async function cancelForTransition(
  transition: ReminderMarker,
): Promise<void> {
  if (!matchesFence(readReminderMarker(), transition)) {
    throw new ReminderTransitionChangedError();
  }

  await cancelScheduledReminders();

  if (!matchesFence(readReminderMarker(), transition)) {
    await cancelScheduledReminders();
  }
}

export interface ReconcileRemindersInput {
  /**
   * Whether this build resolves accounts at all. The auth-disabled development
   * configuration has one device-level store and no owner marker, so there is
   * no account ownership to enforce; the plan still goes through this module
   * so the app has a single scheduling entry point.
   */
  readonly authEnabled: boolean;
  /** The account the plan was computed for, or null when signed out. */
  readonly ownerId: string | null;
  readonly plan: readonly PlannedReminder[];
}

/**
 * Applies the complete reminder plan for `ownerId`, cancelling first.
 *
 * Returns "forbidden" without touching the plugin when the plan cannot prove it
 * belongs to the current session owner and the current marker.
 */
export async function reconcileReminders(
  input: ReconcileRemindersInput,
): Promise<ScheduleResult> {
  if (typeof window === "undefined") return "unsupported";

  // Permission can prompt, and a prompt may stay up for as long as the user
  // takes, so it happens before the identity lock is taken.
  const prepared = await prepareReminderScheduling();
  if (prepared !== "ready") return prepared;

  if (!input.authEnabled) {
    return reconcilePlan(input.plan);
  }

  const ownerId = input.ownerId;
  if (!ownerId) return "forbidden";

  try {
    return await withIdentityLock(async () => {
      const session = await readOwner();
      if (session !== ownerId) return "forbidden";

      const expectedOwner = await reminderOwnerHash(ownerId);
      const marker = readReminderMarker();
      if (
        !marker ||
        marker.phase !== "active" ||
        marker.owner !== expectedOwner
      ) {
        return "forbidden";
      }

      const fence: Fence = { epoch: marker.epoch, tid: marker.tid };
      const result = await reconcilePlan(input.plan, fence);

      if (!matchesFence(readReminderMarker(), fence)) {
        await cancelScheduledReminders();
        return "stale";
      }
      return result;
    });
  } catch {
    return "error";
  }
}

/**
 * Full reconciliation: cancel every native reminder, then schedule the whole
 * plan. `fence` is re-checked immediately before the native calls so a plan
 * captured for an older transition cannot recreate reminders.
 */
async function reconcilePlan(
  plan: readonly PlannedReminder[],
  fence?: Fence,
): Promise<ScheduleResult> {
  try {
    if (fence && !matchesFence(readReminderMarker(), fence)) return "stale";
    await cancelScheduledReminders();
    if (fence && !matchesFence(readReminderMarker(), fence)) {
      await cancelScheduledReminders();
      return "stale";
    }
    if (plan.length === 0) return "scheduled";
    return await scheduleReminders(plan);
  } catch {
    return "error";
  }
}

export interface OwnedNotification {
  /** Stable dedupe id; the same id is never delivered twice per session. */
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface DeliverNotificationInput {
  readonly authEnabled: boolean;
  readonly ownerId: string | null;
  readonly notification: OwnedNotification;
  readonly alreadyNotified: ReadonlySet<string>;
}

/**
 * Delivers one in-session notification if, and only if, its owner is still the
 * session owner and the reminder marker still names that owner.
 *
 * Returns true when the notification was shown; the caller records the id so a
 * later tick does not repeat it.
 */
export async function deliverOwnerNotification(
  input: DeliverNotificationInput,
): Promise<boolean> {
  if (input.alreadyNotified.has(input.notification.id)) return false;

  if (!input.authEnabled) {
    return showNotification(input.notification);
  }

  const ownerId = input.ownerId;
  if (!ownerId) return false;

  try {
    return await withIdentityLock(async () => {
      // A concurrent tick may have delivered this id while we waited for the
      // lock; the pre-lock check alone cannot see that.
      if (input.alreadyNotified.has(input.notification.id)) return false;

      const session = await readOwner();
      if (session !== ownerId) return false;

      const expectedOwner = await reminderOwnerHash(ownerId);
      const marker = readReminderMarker();
      if (
        !marker ||
        marker.phase !== "active" ||
        marker.owner !== expectedOwner
      ) {
        return false;
      }

      return showNotification(input.notification);
    });
  } catch {
    return false;
  }
}

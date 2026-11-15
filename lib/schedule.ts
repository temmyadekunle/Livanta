/**
 * Native reminder bridge (ADR 0002 §5.2 step 7 and step 10).
 *
 * On a native platform (the Android APK) reminders are handed to
 * @capacitor/local-notifications, which schedules them with AlarmManager —
 * they fire with the app closed. On the web there is no supported API for
 * scheduled notifications (the Notification Triggers API was withdrawn; Web
 * Push needs a push server, which this local-first app deliberately does not
 * have), so these primitives report "unsupported" and the app shell falls back
 * to in-session notifications.
 *
 * This module performs no ownership checks. Every call is made by the reminder
 * coordinator, which validates the session owner, the persisted owner marker
 * and the transition id under the identity lock. Keeping the bridge free of
 * policy is what makes that a single gate rather than several.
 *
 * Two properties still live here, because they are properties of the plugin:
 *
 * - Cancellation is unconditional. It does not consult display permission,
 *   because a leftover notification from a previous account must be dropped
 *   regardless of what the user answered in a permission dialog.
 * - Plugin calls are serialised in this tab, so two bridge calls can never
 *   interleave inside the plugin even if a caller forgets the identity lock.
 */

import type { PlannedReminder } from "./reminders.ts";

export type ScheduleResult =
  /** The plugin accepted the batch. */
  | "scheduled"
  /** Not a native app (the web build) — fall back to in-session notifications. */
  | "unsupported"
  /** The user has notifications switched off at the OS level. */
  | "denied"
  /** The plan's owner is not the session owner, or the transition moved. */
  | "forbidden"
  /** A newer transition took over while this plan was being applied. */
  | "stale"
  /** Something threw; no reminder was scheduled. */
  | "error";

export class ReminderCancellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReminderCancellationError";
  }
}

/**
 * Deterministic 31-bit FNV-1a of the stable reminder id. The plugin requires a
 * number; collisions across a few hundred reminders are astronomically
 * unlikely, and the plan is re-sent wholesale on every change anyway.
 */
export function reminderNativeId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

function toNative(reminder: PlannedReminder) {
  return {
    id: reminderNativeId(reminder.id),
    title: reminder.title,
    body: reminder.body,
    sound: "default" as const,
    // Android: fire in Doze instead of waiting for the next maintenance
    // window. The reminder is a date reminder, not a calendar event, so
    // firing a little late is worse than a modest battery cost.
    allowWhileIdle: true,
    inForeground: false,
    extra: { thingId: reminder.thingId, lead: reminder.lead },
    schedule: { at: reminder.fireAt },
  };
}

type NativeNotification = ReturnType<typeof toNative>;

/** The subset of @capacitor/local-notifications this module relies on. */
export interface ReminderNativeAdapter {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  cancelAll(): Promise<void>;
  schedule(options: { notifications: NativeNotification[] }): Promise<void>;
}

let adapterOverride: ReminderNativeAdapter | null = null;

/**
 * Replaces the native bridge for tests. Pass null to restore the real plugin.
 * Production code never calls this.
 */
export function setReminderAdapterForTesting(
  adapter: ReminderNativeAdapter | null,
): void {
  adapterOverride = adapter;
}

/** Resets the plugin queue and adapter override between tests. */
export function resetReminderSchedulingForTesting(): void {
  criticalSection = Promise.resolve();
  adapterOverride = null;
}

async function loadNativeAdapter(): Promise<ReminderNativeAdapter | null> {
  if (adapterOverride) return adapterOverride;
  if (typeof window === "undefined") return null;

  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return null;

  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return {
    checkPermissions: () => LocalNotifications.checkPermissions(),
    requestPermissions: () => LocalNotifications.requestPermissions(),
    cancelAll: () => LocalNotifications.cancelAll(),
    schedule: async (options) => {
      await LocalNotifications.schedule(
        options as Parameters<typeof LocalNotifications.schedule>[0],
      );
    },
  };
}

/** Serialises plugin calls so a cancel can never be undone by an older plan. */
let criticalSection: Promise<unknown> = Promise.resolve();

function withPluginAccess<T>(work: () => Promise<T>): Promise<T> {
  const run = criticalSection.then(work, work);
  criticalSection = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Resolves whether native scheduling is possible, requesting display
 * permission when the platform can still ask. The coordinator calls this
 * before taking the identity lock, because a permission dialog may stay up for
 * as long as the user takes and must not hold the transition lock.
 */
export async function prepareReminderScheduling(): Promise<
  "ready" | "unsupported" | "denied"
> {
  try {
    const adapter = await loadNativeAdapter();
    if (!adapter) return "unsupported";

    let permission = await adapter.checkPermissions();
    if (permission.display === "prompt") {
      permission = await adapter.requestPermissions();
    }
    return permission.display === "granted" ? "ready" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Unconditional cancellation primitive (ADR 0002 §5.2 step 7). Drops every
 * notification this app scheduled, without a permission check and without
 * considering which account owns them.
 *
 * Returns without error on non-native platforms where there is nothing to
 * cancel. Throws ReminderCancellationError when a native cancellation does not
 * complete, so the caller can keep the app blocked on an unknown reminder
 * state.
 */
export async function cancelScheduledReminders(): Promise<void> {
  if (typeof window === "undefined") return;
  if (typeof window.navigator === "undefined") {
    throw new ReminderCancellationError(
      "No navigator available; cannot cancel reminders.",
    );
  }

  try {
    const adapter = await loadNativeAdapter();
    if (!adapter) return;
    await withPluginAccess(() => adapter.cancelAll());
  } catch (e) {
    if (e instanceof ReminderCancellationError) throw e;
    throw new ReminderCancellationError(
      `Failed to cancel scheduled reminders: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Schedules exactly the given plan. The caller is responsible for having
 * cancelled first: reconciliation is always a full cancel followed by the full
 * plan (ADR 0002 §5.2 step 10), never a differential add/remove.
 *
 * Does not request permission — that happened before the identity lock was
 * taken. Reports "denied" if it is still not granted.
 */
export async function scheduleReminders(
  reminders: readonly PlannedReminder[],
): Promise<"scheduled" | "unsupported" | "denied" | "error"> {
  if (typeof window === "undefined") return "unsupported";

  try {
    const adapter = await loadNativeAdapter();
    if (!adapter) return "unsupported";

    const permission = await adapter.checkPermissions();
    if (permission.display !== "granted") return "denied";

    if (reminders.length === 0) return "scheduled";

    await withPluginAccess(() =>
      adapter.schedule({ notifications: reminders.map(toNative) }),
    );
    return "scheduled";
  } catch {
    return "error";
  }
}

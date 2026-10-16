/**
 * Native reminder scheduling bridge.
 *
 * On a native platform (the Android APK) reminders are handed to
 * @capacitor/local-notifications, which schedules them with AlarmManager —
 * they fire with the app closed. On the web there is no supported API for
 * scheduled notifications (the Notification Triggers API was withdrawn; Web
 * Push needs a push server, which this local-first app deliberately does not
 * have), so this module reports "unsupported" and the app shell falls back to
 * in-session notifications. Nothing here claims otherwise: "scheduled" is only
 * ever returned on a native platform where the plugin accepted the batch.
 *
 * Reconciliation is all-or-nothing: every call cancels everything previously
 * scheduled by the app, then schedules the given plan. That keeps ids from
 * leaking when a thing is deleted, renamed, or its due date moves, and it makes
 * "turn notifications off" a single cancel.
 */
import type { PlannedReminder } from "./reminders.ts";

export type ScheduleResult =
  /** Native platform accepted the batch. */
  | "scheduled"
  /** Not a native app (the web build) — fall back to in-session notifications. */
  | "unsupported"
  /** The user has notifications switched off at the OS level. */
  | "denied"
  /** Something threw; treated as unsupported rather than surfaced as an error. */
  | "error";

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

export async function rescheduleReminders(
  reminders: PlannedReminder[],
): Promise<ScheduleResult> {
  if (typeof window === "undefined") return "unsupported";

  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return "unsupported";

    const { LocalNotifications } = await import("@capacitor/local-notifications");

    let perm = await LocalNotifications.checkPermissions();
    if (perm.display === "prompt") {
      perm = await LocalNotifications.requestPermissions();
    }
    if (perm.display !== "granted") return "denied";

    // Full reconcile: drop anything from a previous plan before scheduling the
    // new one, so a deleted thing cannot keep notifying.
    await LocalNotifications.cancelAll();

    if (reminders.length === 0) return "scheduled";

    await LocalNotifications.schedule({
      notifications: reminders.map((r) => ({
        id: reminderNativeId(r.id),
        title: r.title,
        body: r.body,
        sound: "default",
        // Android: fire in Doze instead of waiting for the next maintenance
        // window. The reminder is a date reminder, not a calendar event, so
        // firing a little late is worse than a modest battery cost.
        allowWhileIdle: true,
        inForeground: false,
        extra: { thingId: r.thingId, lead: r.lead },
        schedule: { at: r.fireAt },
      })),
    });

    return "scheduled";
  } catch {
    return "error";
  }
}

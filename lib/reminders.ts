/**
 * Reminder planning.
 *
 * Pure date logic: turns the user's things + lead-day settings into a list of
 * future notification moments. No I/O, no Capacitor, no DOM — the platform
 * bridge lives in lib/schedule.ts, and the in-session fallback in the app shell
 * consumes the same plan, so every surface agrees on what is due.
 *
 * Timing choices:
 *   - Reminders fire at 09:00 local on the day a lead threshold is crossed
 *     (due minus lead days). Local wall-clock because a bill due on the 25th is
 *     due on the 25th wherever the reader is.
 *   - A lead whose fire time has already passed is skipped, not back-filled:
 *     switching leadDays from [7] to [30, 7] on the day a bill is due in 5 must
 *     not produce a "due in 30 days" notification tonight.
 *   - An overdue thing gets exactly one reminder at the next 09:00, id-stable
 *     so rescheduling replaces it rather than stacking daily nags.
 *   - The plan is capped well under Android's ~500-notification limit and
 *     bounded by a horizon (default 90 days, the widest standard lead).
 */
import { reminderCopy } from "./notifications.ts";
import { daysUntil, englishT, type DayDiff } from "./risk.ts";
import type { Translate } from "./i18n.ts";
import { parseISO } from "./dates.ts";
import type { Thing } from "./types.ts";

/** Local wall-clock hour reminders are delivered at. */
export const REMINDER_HOUR = 9;

export interface PlannedReminder {
  /** Stable per thing+lead (or thing+overdue). Safe to derive a native id from. */
  id: string;
  thingId: string;
  /** The lead threshold crossed, or null for the overdue nudge. */
  lead: number | null;
  /** Instant the reminder should appear, in the reader's local zone. */
  fireAt: Date;
  title: string;
  body: string;
}

export interface PlanOptions {
  /** The user's chosen lead days, e.g. [90, 30, 7]. */
  leadDays: number[];
  /** Translated copy source. Defaults to English. */
  tr?: Translate;
  /** Injectable clock for tests. */
  now?: Date;
  /** Only schedule moments up to this many days ahead. Defaults to 90. */
  horizonDays?: number;
  /** Hard cap on planned reminders. Defaults to 100. */
  max?: number;
  /** Injectable day-count for tests; see lib/risk.ts. */
  dayDiff?: DayDiff;
}

/** The next 09:00 that is still in the future (today if before 9am, else tomorrow). */
export function nextReminderMoment(now: Date, hour: number = REMINDER_HOUR): Date {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (at.getTime() > now.getTime()) return at;
  at.setDate(at.getDate() + 1);
  return at;
}

/** 09:00 local on the given calendar day. */
export function reminderMomentOn(day: Date, hour: number = REMINDER_HOUR): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
}

export function planReminders(things: Thing[], opts: PlanOptions): PlannedReminder[] {
  const {
    leadDays,
    tr = englishT,
    now = new Date(),
    horizonDays = 90,
    max = 100,
    dayDiff = daysUntil,
  } = opts;

  const horizonEnd = new Date(now.getTime() + horizonDays * 86_400_000);
  const leads = [...new Set(leadDays.filter((n) => Number.isFinite(n) && n > 0))].sort(
    (a, b) => b - a,
  );

  const out: PlannedReminder[] = [];
  const seen = new Set<string>();

  const push = (reminder: PlannedReminder) => {
    if (seen.has(reminder.id)) return;
    if (reminder.fireAt.getTime() <= now.getTime()) return;
    if (reminder.fireAt.getTime() > horizonEnd.getTime()) return;
    seen.add(reminder.id);
    out.push(reminder);
  };

  for (const thing of things) {
    if (thing.status !== "active" || !thing.dueDate) continue;

    const days = dayDiff(thing.dueDate, now);

    if (days < 0) {
      push({
        id: `${thing.id}:overdue`,
        thingId: thing.id,
        lead: null,
        fireAt: nextReminderMoment(now),
        title: tr("alert.overdue.title", { name: thing.name }),
        body: thing.notes?.trim() || tr("reminder.generic.body.default"),
      });
      continue;
    }

    for (const lead of leads) {
      const due = parseISO(thing.dueDate);
      due.setDate(due.getDate() - lead);
      const copy = reminderCopy(thing, lead, tr);
      push({
        id: `${thing.id}:${lead}`,
        thingId: thing.id,
        lead,
        fireAt: reminderMomentOn(due),
        title: copy.title,
        body: copy.body,
      });
    }
  }

  return out
    .sort((a, b) => {
      const dt = a.fireAt.getTime() - b.fireAt.getTime();
      return dt !== 0 ? dt : a.id.localeCompare(b.id);
    })
    .slice(0, Math.max(0, max));
}

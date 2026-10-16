import test from "node:test";
import {
  REMINDER_HOUR,
  nextReminderMoment,
  planReminders,
  reminderMomentOn,
} from "../lib/reminders.ts";
import { reminderNativeId, rescheduleReminders } from "../lib/schedule.ts";
import { assert, makeThing } from "./helpers.ts";

/** Local clock, so the planner's wall-clock maths is deterministic in any TZ. */
const NOW = new Date(2026, 9, 3, 8, 0);

function localIso(daysFromNow: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + daysFromNow);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function atLocalHour(daysFromNow: number, hour = REMINDER_HOUR): Date {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

test("planReminders", async (t) => {
  await t.test("fires at 9am local on the day a lead is crossed", () => {
    const thing = makeThing({ id: "rent", kind: "rent", dueDate: localIso(30) });
    const plan = planReminders([thing], { leadDays: [30], now: NOW });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, "rent:30");
    assert.equal(plan[0].lead, 30);
    // Due in 30 days, so the 30-day lead fires today at 9am (NOW is 8am).
    assert.equal(plan[0].fireAt.getTime(), atLocalHour(0).getTime());
    assert.equal(plan[0].title, "Rent is due in 30 days");
  });

  await t.test("skips a lead whose moment has already passed", () => {
    const thing = makeThing({ id: "b", dueDate: localIso(10) });
    const plan = planReminders([thing], { leadDays: [30], now: NOW });
    assert.deepEqual(plan, []);
  });

  await t.test("plans every still-future lead for the same thing", () => {
    const thing = makeThing({ id: "b", dueDate: localIso(30) });
    const plan = planReminders([thing], { leadDays: [90, 30, 7], now: NOW });
    assert.deepEqual(
      plan.map((r) => r.id),
      ["b:30", "b:7"],
    );
    // 30-day lead: due-in-30 minus 30 = today 9am. 7-day lead: 23 days out.
    assert.equal(plan[0].fireAt.getTime(), atLocalHour(0).getTime());
    assert.equal(plan[1].fireAt.getTime(), atLocalHour(23).getTime());
  });

  await t.test("an overdue thing gets exactly one reminder at the next 9am", () => {
    const thing = makeThing({ id: "late", dueDate: localIso(-3), notes: "Pay now" });
    const plan = planReminders([thing], { leadDays: [7], now: NOW });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, "late:overdue");
    assert.equal(plan[0].lead, null);
    // NOW is 08:00, so "next 9am" is still today.
    assert.equal(plan[0].fireAt.getTime(), atLocalHour(0).getTime());
    assert.equal(plan[0].title, "Test thing is overdue");
    assert.equal(plan[0].body, "Pay now");
  });

  await t.test("after 9am the overdue nudge moves to tomorrow morning", () => {
    const afterNine = new Date(2026, 9, 3, 10, 0);
    const thing = makeThing({ id: "late", dueDate: localIso(-3) });
    const plan = planReminders([thing], { leadDays: [7], now: afterNine });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].fireAt.getTime(), atLocalHour(1).getTime());
  });

  await t.test("ignores completed things and things without a due date", () => {
    const done = makeThing({ id: "done", status: "completed", dueDate: localIso(3) });
    const undated = makeThing({ id: "nodate", dueDate: null });
    assert.deepEqual(planReminders([done, undated], { leadDays: [7], now: NOW }), []);
  });

  await t.test("respects a custom lead list", () => {
    const thing = makeThing({ id: "b", dueDate: localIso(14) });
    const plan = planReminders([thing], { leadDays: [14], now: NOW });
    assert.deepEqual(
      plan.map((r) => r.id),
      ["b:14"],
    );
  });

  await t.test("caps the plan at max", () => {
    const things = Array.from({ length: 5 }, (_, i) =>
      makeThing({ id: `t${i}`, dueDate: localIso(7) }),
    );
    const plan = planReminders(things, { leadDays: [7], now: NOW, max: 3 });
    assert.equal(plan.length, 3);
  });

  await t.test("excludes fire times beyond the horizon", () => {
    // A 7-day lead on something due in 20 days fires in 13 days.
    const thing = makeThing({ id: "far", dueDate: localIso(20) });
    assert.deepEqual(
      planReminders([thing], { leadDays: [7], now: NOW, horizonDays: 10 }),
      [],
    );
    assert.equal(
      planReminders([thing], { leadDays: [7], now: NOW, horizonDays: 30 }).length,
      1,
    );
  });

  await t.test("schedules future leads before their day arrives", () => {
    // Due in 30 days with a 7-day lead: the 7-day reminder fires in 23 days
    // and must be planned now so a closed-app scheduler can hold the alarm.
    const thing = makeThing({ id: "b", dueDate: localIso(30) });
    const plan = planReminders([thing], { leadDays: [7], now: NOW });
    assert.deepEqual(
      plan.map((r) => r.id),
      ["b:7"],
    );
    assert.equal(plan[0].fireAt.getTime(), atLocalHour(23).getTime());
  });

  await t.test("ids are stable across runs with the same inputs", () => {
    const things = [
      makeThing({ id: "a", dueDate: localIso(30) }),
      makeThing({ id: "b", dueDate: localIso(-1) }),
    ];
    const one = planReminders(things, { leadDays: [30, 7], now: NOW });
    const two = planReminders(things, { leadDays: [30, 7], now: NOW });
    assert.deepEqual(
      one.map((r) => r.id),
      two.map((r) => r.id),
    );
    assert.deepEqual(
      one.map((r) => r.id).sort(),
      ["a:30", "a:7", "b:overdue"],
    );
  });

  await t.test("sorts by fire time then id", () => {
    // z's only fire moment is today 9am; a fires today 9am (tie, broken by id)
    // and again in a week. Both criteria in one assertion.
    const z = makeThing({ id: "z", dueDate: localIso(7) });
    const a = makeThing({ id: "a", dueDate: localIso(14) });
    const plan = planReminders([a, z], { leadDays: [14, 7], now: NOW });
    assert.deepEqual(
      plan.map((r) => r.id),
      ["a:14", "z:7", "a:7"],
    );
  });

  await t.test("falls back to generic body text when the thing has no notes", () => {
    const thing = makeThing({ id: "b", kind: "bill", dueDate: localIso(7), notes: null });
    const plan = planReminders([thing], { leadDays: [7], now: NOW });
    assert.equal(plan[0].body, "Open Livanta to prepare for it.");
  });
});

test("nextReminderMoment and reminderMomentOn", async (t) => {
  await t.test("stays on today when 9am has not passed", () => {
    const now = new Date(2026, 9, 3, 8, 30);
    assert.equal(nextReminderMoment(now).getTime(), atLocalHour(0).getTime());
  });

  await t.test("moves to tomorrow once 9am has passed", () => {
    const now = new Date(2026, 9, 3, 9, 0, 1);
    assert.equal(nextReminderMoment(now).getTime(), atLocalHour(1).getTime());
  });

  await t.test("reminderMomentOn pins the given hour on the day", () => {
    const day = new Date(2026, 10, 25);
    const at = reminderMomentOn(day);
    assert.equal(at.getFullYear(), 2026);
    assert.equal(at.getMonth(), 10);
    assert.equal(at.getDate(), 25);
    assert.equal(at.getHours(), REMINDER_HOUR);
  });
});

test("reminderNativeId", async (t) => {
  await t.test("is deterministic", () => {
    assert.equal(reminderNativeId("thing-1:30"), reminderNativeId("thing-1:30"));
  });

  await t.test("stays inside the plugin's positive 31-bit range", () => {
    for (const id of ["a", "thing-1:overdue", "x".repeat(200)]) {
      const n = reminderNativeId(id);
      assert.ok(Number.isInteger(n) && n > 0 && n <= 0x7fffffff, `${id} -> ${n}`);
    }
  });

  await t.test("separates different ids", () => {
    assert.notEqual(reminderNativeId("a:7"), reminderNativeId("a:30"));
  });
});

test("rescheduleReminders reports unsupported without a DOM", async () => {
  assert.equal(await rescheduleReminders([]), "unsupported");
});

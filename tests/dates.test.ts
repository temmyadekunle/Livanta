import test from "node:test";

import { assert } from "./helpers.ts";

import { dayPart, nextOccurrence } from "../lib/dates.ts";
import { en } from "../lib/locales/en.ts";
import { greetingKey } from "../lib/useDayPart.ts";

/** Built in local time on purpose: dayPart reads the reader's own clock, so a
    test that pinned the zone would be testing the wrong thing. */
function at(hour: number, minute = 0): Date {
  const d = new Date(2026, 9, 3, hour, minute, 0, 0);
  return d;
}

test("dayPart", async (t) => {
  await t.test("calls the early hours evening, not morning", () => {
    // "Good morning" at 02:00 reads as though the app has the wrong idea of the
    // time, which is the complaint this whole change started from.
    assert.equal(dayPart(at(0)), "evening");
    assert.equal(dayPart(at(4, 59)), "evening");
  });

  await t.test("starts the morning at five", () => {
    assert.equal(dayPart(at(5)), "morning");
    assert.equal(dayPart(at(11, 59)), "morning");
  });

  await t.test("treats noon as the afternoon", () => {
    assert.equal(dayPart(at(12)), "afternoon");
    assert.equal(dayPart(at(17, 59)), "afternoon");
  });

  await t.test("starts the evening at six", () => {
    assert.equal(dayPart(at(18)), "evening");
    assert.equal(dayPart(at(23, 59)), "evening");
  });

  await t.test("covers all 24 hours with no hour unclaimed", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const part = dayPart(at(hour));
      assert.ok(
        part === "morning" || part === "afternoon" || part === "evening",
        `hour ${hour} produced ${part}`,
      );
    }
  });

  await t.test("never reports the same part on both sides of a boundary", () => {
    const boundaries: Array<[number, string, string]> = [
      [5, "evening", "morning"],
      [12, "morning", "afternoon"],
      [18, "afternoon", "evening"],
      // Midnight wraps rather than advancing to a fourth label.
      [0, "evening", "evening"],
    ];
    for (const [hour, before, after] of boundaries) {
      assert.equal(dayPart(at(hour)), after, `hour ${hour} should start ${after}`);
      assert.equal(dayPart(at(hour - 1 === -1 ? 23 : hour - 1)), before);
    }
  });
});

test("greetingKey", async (t) => {
  await t.test("maps each part to its own key", () => {
    assert.equal(greetingKey("morning"), "app.greeting.morning");
    assert.equal(greetingKey("afternoon"), "app.greeting.afternoon");
    assert.equal(greetingKey("evening"), "app.greeting.evening");
  });

  await t.test("the three keys are actually different sentences", () => {
    // Guards against a copy-paste that leaves every greeting identical, which
    // would pass the "differs from English" locale check while still being wrong.
    assert.notEqual(en["app.greeting.morning"], en["app.greeting.afternoon"]);
    assert.notEqual(en["app.greeting.afternoon"], en["app.greeting.evening"]);
    assert.notEqual(en["app.greeting.morning"], en["app.greeting.evening"]);
  });
});

test("nextOccurrence", async (t) => {
  await t.test("weekly and biweekly are exact day steps", () => {
    assert.equal(nextOccurrence("2026-10-03", "weekly"), "2026-10-10");
    assert.equal(nextOccurrence("2026-10-03", "biweekly"), "2026-10-17");
  });

  await t.test("weekly steps across a month boundary", () => {
    assert.equal(nextOccurrence("2026-10-28", "weekly"), "2026-11-04");
  });

  await t.test("monthly adds a calendar month, not 30 days", () => {
    assert.equal(nextOccurrence("2026-10-03", "monthly"), "2026-11-03");
    assert.equal(nextOccurrence("2026-12-15", "monthly"), "2027-01-15");
  });

  await t.test("monthly clamps to the end of a shorter month", () => {
    assert.equal(nextOccurrence("2026-01-31", "monthly"), "2026-02-28");
    assert.equal(nextOccurrence("2024-01-31", "monthly"), "2024-02-29");
    assert.equal(nextOccurrence("2026-03-31", "monthly"), "2026-04-30");
  });

  await t.test("a clamped day becomes the new anchor", () => {
    // The user thinks of it as "the 28th from now on" once February clamped.
    assert.equal(nextOccurrence("2026-02-28", "monthly"), "2026-03-28");
  });

  await t.test("quarterly and biannual are whole calendar months", () => {
    assert.equal(nextOccurrence("2026-10-03", "quarterly"), "2027-01-03");
    assert.equal(nextOccurrence("2026-10-31", "quarterly"), "2027-01-31");
    assert.equal(nextOccurrence("2026-01-31", "biannual"), "2026-07-31");
  });

  await t.test("annual lands on the same day next year, clamping Feb 29", () => {
    assert.equal(nextOccurrence("2026-10-03", "annual"), "2027-10-03");
    assert.equal(nextOccurrence("2024-02-29", "annual"), "2025-02-28");
  });

  await t.test("interval multiplies the step", () => {
    assert.equal(nextOccurrence("2026-10-03", "weekly", 3), "2026-10-24");
    assert.equal(nextOccurrence("2026-10-03", "monthly", 2), "2026-12-03");
    assert.equal(nextOccurrence("2026-01-31", "monthly", 3), "2026-04-30");
  });

  await t.test("interval below 1 is treated as 1", () => {
    assert.equal(nextOccurrence("2026-10-03", "weekly", 0), "2026-10-10");
    assert.equal(nextOccurrence("2026-10-03", "monthly", -2), "2026-11-03");
  });

  await t.test("none returns null", () => {
    assert.equal(nextOccurrence("2026-10-03", "none"), null);
  });
});

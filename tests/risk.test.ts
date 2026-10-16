import test from "node:test";
import {
  addFrequency,
  assert,
  buildAlerts,
  daysUntil,
  derivePriority,
  formatNaira,
  iso,
  makeThing,
  NOW,
} from "./helpers.ts";

test("daysUntil", async (t) => {
  await t.test("counts forward", () => {
    assert.equal(daysUntil(iso(30), NOW), 30);
  });

  await t.test("counts backward for past dates", () => {
    assert.equal(daysUntil(iso(-5), NOW), -5);
  });

  await t.test("is zero for today", () => {
    assert.equal(daysUntil(iso(0), NOW), 0);
  });
});

test("addFrequency", async (t) => {
  await t.test("monthly rolls forward one calendar month", () => {
    assert.equal(addFrequency("2026-10-03", "monthly"), "2026-11-03");
  });

  await t.test("annual rolls forward a year", () => {
    assert.equal(addFrequency("2026-10-03", "annual"), "2027-10-03");
  });

  await t.test("none returns null", () => {
    assert.equal(addFrequency("2026-10-03", "none"), null);
  });

  await t.test("delegates to the shared calendar-correct maths", () => {
    // Quarterly from the 31st clamps to April 30 — a fixed 91-day step would
    // have landed on May 1 and then kept drifting.
    assert.equal(addFrequency("2026-01-31", "quarterly"), "2026-04-30");
  });
});

test("formatNaira", () => {
  assert.equal(formatNaira(1_200_000), "\u20A61,200,000");
});

test("derivePriority boundaries", async (t) => {
  const cases: [string, number, string][] = [
    ["overdue is urgent", -3, "urgent"],
    ["due today is urgent", 0, "urgent"],
    ["1 day out is urgent", 1, "urgent"],
    ["7 days out is urgent", 7, "urgent"],
    ["8 days out is important", 8, "important"],
    ["30 days out is important", 30, "important"],
    ["31 days out is upcoming", 31, "upcoming"],
    ["90 days out is upcoming", 90, "upcoming"],
    ["91 days out is routine", 91, "routine"],
  ];

  for (const [label, days, expected] of cases) {
    await t.test(label, () => {
      const thing = makeThing({ dueDate: iso(days) });
      assert.equal(derivePriority(thing, NOW), expected);
    });
  }

  await t.test("already-handled items are routine", () => {
    const thing = makeThing({ dueDate: iso(2), lastHandledDate: iso(1) });
    assert.equal(derivePriority(thing, NOW), "routine");
  });

  await t.test("archived items are routine", () => {
    const thing = makeThing({ dueDate: iso(1), status: "archived" });
    assert.equal(derivePriority(thing, NOW), "routine");
  });
});

test("buildAlerts", async (t) => {
  await t.test("ignores completed things", () => {
    const alerts = buildAlerts(
      [makeThing({ status: "completed", dueDate: iso(-5) })],
      NOW,
    );
    assert.equal(alerts.length, 0);
  });

  await t.test("flags overdue as urgent", () => {
    const alerts = buildAlerts(
      [makeThing({ name: "Electricity", dueDate: iso(-2) })],
      NOW,
    );
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].reason, "overdue");
    assert.equal(alerts[0].priority, "urgent");
    assert.match(alerts[0].title, /Electricity is overdue/);
  });

  await t.test("flags a document expiring within 30 days", () => {
    const alerts = buildAlerts(
      [makeThing({ kind: "document", dueDate: iso(10) })],
      NOW,
    );
    assert.equal(alerts[0].reason, "expiring");
  });

  await t.test("flags service overdue for maintenance without a due date", () => {
    const alerts = buildAlerts(
      [
        makeThing({
          kind: "maintenance",
          dueDate: null,
          serviceIntervalDays: 90,
          lastHandledDate: iso(-120),
        }),
      ],
      NOW,
    );
    assert.equal(alerts[0].reason, "service-overdue");
  });

  await t.test("flags a thing with no record at all", () => {
    const alerts = buildAlerts([makeThing({ dueDate: null })], NOW);
    assert.equal(alerts[0].reason, "no-record");
  });

  await t.test("stays quiet about far-future documents", () => {
    const alerts = buildAlerts(
      [makeThing({ kind: "document", dueDate: iso(240) })],
      NOW,
    );
    assert.equal(alerts.length, 0);
  });

  await t.test("sorts urgent first", () => {
    const alerts = buildAlerts(
      [
        makeThing({ id: "no-record", dueDate: null }),
        makeThing({ id: "expiring", kind: "document", dueDate: iso(20) }),
        makeThing({ id: "overdue", dueDate: iso(-1) }),
      ],
      NOW,
    );
    assert.equal(alerts.length, 3);
    assert.equal(alerts[0].priority, "urgent");
    assert.equal(alerts[1].priority, "important");
    assert.equal(alerts[2].priority, "routine");
  });
});
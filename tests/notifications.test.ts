import test from "node:test";
import {
  exportPayload,
  leadDaysCrossed,
  notificationPermission,
  reminderCopy,
  showNotification,
} from "../lib/notifications.ts";
import { assert, iso, makeThing, NOW } from "./helpers.ts";

test("notificationPermission is unsupported without a DOM", () => {
  assert.equal(notificationPermission(), "unsupported");
});

test("requestNotificationPermission is unsupported without a DOM", async () => {
  const { requestNotificationPermission } = await import("../lib/notifications.ts");
  assert.equal(await requestNotificationPermission(), "unsupported");
});

test("showNotification is a no-op without a DOM", () => {
  assert.equal(
    showNotification({ id: "a", title: "Title", body: "Body" }),
    false,
  );
});

test("leadDaysCrossed", async (t) => {
  const LEADS = [90, 30, 7, 1];

  await t.test("returns nothing for an undated thing", () => {
    assert.deepEqual(leadDaysCrossed(makeThing({ dueDate: null }), LEADS, NOW), []);
  });

  await t.test("returns nothing when no threshold is hit exactly", () => {
    assert.deepEqual(leadDaysCrossed(makeThing({ dueDate: iso(45) }), LEADS, NOW), []);
  });

  await t.test("fires on an exact hit", () => {
    assert.deepEqual(leadDaysCrossed(makeThing({ dueDate: iso(30) }), LEADS, NOW), [30]);
  });

  await t.test("preserves the caller's lead order", () => {
    const due = iso(7);
    assert.deepEqual(leadDaysCrossed(makeThing({ dueDate: due }), [7, 30, 1], NOW), [7]);
  });
});

test("reminderCopy for documents", async (t) => {
  const doc = () => makeThing({ name: "Passport", kind: "document" });

  await t.test("uses long-lead copy at 90 days", () => {
    const r = reminderCopy(doc(), 90);
    assert.equal(r.title, "Passport expires in about 3 months");
  });

  await t.test("uses next-month copy at 30 days", () => {
    assert.equal(reminderCopy(doc(), 30).title, "Passport expires next month");
  });

  await t.test("uses a day count at 60 days rather than next month", () => {
    assert.equal(reminderCopy(doc(), 60).title, "Passport expires in 60 days");
  });

  await t.test("uses a day count between 2 and 29 days", () => {
    assert.equal(reminderCopy(doc(), 14).title, "Passport expires in 14 days");
  });

  await t.test("switches to next-month copy at exactly 30 days", () => {
    assert.equal(reminderCopy(doc(), 29).title, "Passport expires in 29 days");
    assert.equal(reminderCopy(doc(), 30).title, "Passport expires next month");
  });

  await t.test("uses tomorrow copy at 1 day", () => {
    assert.equal(reminderCopy(doc(), 1).title, "Passport expires tomorrow");
  });

  await t.test("uses tomorrow copy when already overdue", () => {
    assert.equal(reminderCopy(doc(), 0).title, "Passport expires tomorrow");
  });
});

test("reminderCopy for rent", async (t) => {
  await t.test("pluralises days", () => {
    assert.equal(
      reminderCopy(makeThing({ kind: "rent" }), 7).title,
      "Rent is due in 7 days",
    );
  });

  await t.test("uses singular for one day", () => {
    assert.equal(
      reminderCopy(makeThing({ kind: "rent" }), 1).title,
      "Rent is due in 1 day",
    );
  });
});

test("reminderCopy for other things", async (t) => {
  await t.test("uses the thing name", () => {
    assert.equal(
      reminderCopy(makeThing({ name: "School fees", kind: "school-fee" }), 14).title,
      "School fees is due in 14 days",
    );
  });

  await t.test("prefers the thing's notes as the body", () => {
    assert.equal(
      reminderCopy(makeThing({ notes: "Pay at the portal" }), 14).body,
      "Pay at the portal",
    );
  });

  await t.test("falls back to generic body text", () => {
    assert.equal(
      reminderCopy(makeThing({ notes: null }), 14).body,
      "Open Livanta to prepare for it.",
    );
  });
});

test("exportPayload", async (t) => {
  const things = [makeThing({ id: "a" }), makeThing({ id: "b" })];
  const settings = { displayName: "Temmy" } as never;

  await t.test("is valid JSON with the app name and version", () => {
    const parsed = JSON.parse(exportPayload(things, settings));
    assert.equal(parsed.app, "Livanta");
    assert.equal(parsed.version, 1);
  });

  await t.test("includes every thing", () => {
    const parsed = JSON.parse(exportPayload(things, settings));
    assert.equal(parsed.things.length, 2);
  });

  await t.test("includes settings", () => {
    const parsed = JSON.parse(exportPayload(things, settings));
    assert.equal(parsed.settings.displayName, "Temmy");
  });

  await t.test("records an export timestamp", () => {
    const parsed = JSON.parse(exportPayload(things, settings));
    assert.ok(!Number.isNaN(Date.parse(parsed.exportedAt)));
  });

  await t.test("survives a round trip", () => {
    const parsed = JSON.parse(exportPayload(things, settings));
    assert.deepEqual(parsed.things, things);
  });
});
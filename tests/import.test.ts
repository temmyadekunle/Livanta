import test from "node:test";

import { exportPayload } from "../lib/notifications.ts";
import { parseImport, planIsEmpty, type ImportPlan } from "../lib/import.ts";
import { derivePriority } from "../lib/risk.ts";
import { DEFAULT_SETTINGS } from "../lib/settings.ts";
import type { Thing } from "../lib/types.ts";
import { assert, makeThing } from "./helpers.ts";

const NOW = new Date("2026-10-03T09:00:00.000Z");

function payloadOf(things: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ app: "Livanta", version: 1, things, ...extra });
}

function planOf(text: string, existing: Thing[] = []): ImportPlan {
  const result = parseImport(text, { existing, now: NOW });
  assert.equal(result.ok, true, `expected a plan, got ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.plan;
}

test("import", async (t) => {
  await t.test("round-trips an export with no losses", () => {
    const things = [
      makeThing({
        id: "a",
        name: "Rent",
        kind: "rent",
        category: "money",
        amount: 250_000,
        dueDate: "2026-12-01",
        recurrence: { frequency: "monthly", interval: 1 },
      }),
      makeThing({ id: "b", name: "Passport", kind: "document", dueDate: "2027-02-10" }),
      makeThing({ id: "c", name: "Done thing", status: "completed" }),
    ];
    const text = exportPayload(things, DEFAULT_SETTINGS);
    const plan = planOf(text);

    assert.equal(plan.total, 3);
    assert.equal(plan.add.length, 3);
    assert.equal(plan.skipped.length, 0);
    assert.equal(plan.adjusted, 0);

    const imported = new Map(plan.add.map((x) => [x.id, x]));
    for (const original of things) {
      const got = imported.get(original.id);
      assert.ok(got, `missing ${original.id}`);
      assert.equal(got.name, original.name);
      assert.equal(got.category, original.category);
      assert.equal(got.kind, original.kind);
      assert.equal(got.amount, original.amount);
      assert.equal(got.dueDate, original.dueDate);
      assert.equal(got.status, original.status);
      assert.deepEqual(got.recurrence, original.recurrence);
      assert.equal(got.createdAt, original.createdAt);
      assert.equal(got.updatedAt, original.updatedAt);
      // Priority is the one intentionally recomputed field.
      assert.equal(got.priority, derivePriority(original));
    }
  });

  await t.test("rejects invalid JSON", () => {
    const r = parseImport("{not json", { now: NOW });
    assert.deepEqual(r, { ok: false, error: "invalid-json" });
  });

  await t.test("rejects JSON that is not an object", () => {
    assert.deepEqual(parseImport('"hello"', { now: NOW }), {
      ok: false,
      error: "not-livanta",
    });
    assert.deepEqual(parseImport("[]", { now: NOW }), {
      ok: false,
      error: "not-livanta",
    });
  });

  await t.test("rejects a file from another app", () => {
    const r = parseImport(payloadOf([], { app: "OtherApp" }), { now: NOW });
    assert.deepEqual(r, { ok: false, error: "not-livanta" });
  });

  await t.test("rejects an unsupported version", () => {
    const r = parseImport(payloadOf([], { version: 2 }), { now: NOW });
    assert.deepEqual(r, { ok: false, error: "unsupported-version" });
  });

  await t.test("rejects a payload whose things is not an array", () => {
    const r = parseImport(payloadOf({} as unknown as []), { now: NOW });
    assert.deepEqual(r, { ok: false, error: "not-array" });
  });

  await t.test("repairs cosmetic damage instead of dropping the thing", () => {
    const plan = planOf(
      payloadOf([
        {
          id: "x",
          name: "  Padded name  ",
          category: "bogus",
          kind: "not-a-kind",
          status: "weird",
          amount: "lots",
          dueDate: "2026-02-30",
          lastHandledDate: "yesterday",
          recurrence: { frequency: "monthly", interval: 0 },
          serviceIntervalDays: -5,
          details: "not-an-object",
          currency: "USD",
        },
      ]),
    );
    assert.equal(plan.add.length, 1);
    assert.equal(plan.skipped.length, 0);
    assert.equal(plan.adjusted, 1);
    const [thing] = plan.add;
    assert.equal(thing.name, "Padded name");
    assert.equal(thing.category, "tasks");
    assert.equal(thing.kind, "reminder");
    assert.equal(thing.status, "active");
    assert.equal(thing.amount, null);
    assert.equal(thing.dueDate, null);
    assert.equal(thing.lastHandledDate, null);
    assert.deepEqual(thing.recurrence, { frequency: "monthly", interval: 1 });
    assert.equal(thing.serviceIntervalDays, null);
    assert.deepEqual(thing.details, {});
    assert.equal(thing.currency, "NGN");
  });

  await t.test("generates an id when one is missing, and counts it as a repair", () => {
    const plan = planOf(payloadOf([{ name: "No id here" }]));
    assert.equal(plan.add.length, 1);
    assert.ok(plan.add[0].id.length > 0);
    assert.notEqual(plan.add[0].id, "undefined");
    assert.equal(plan.adjusted, 1);
  });

  await t.test("catastrophic recurrence falls back to none", () => {
    const plan = planOf(payloadOf([{ id: "r", name: "R", recurrence: "monthly" }]));
    assert.equal(plan.add[0].recurrence, null);
    assert.equal(plan.adjusted, 1);
  });

  await t.test("truncates oversized notes but keeps the thing", () => {
    const plan = planOf(payloadOf([{ id: "n", name: "N", notes: "x".repeat(5_000) }]));
    assert.equal(plan.add[0].notes?.length, 2_000);
  });

  await t.test("skips structurally hopeless entries with reasons", () => {
    const plan = planOf(
      payloadOf([
        null,
        42,
        { name: "   " },
        { name: "y".repeat(201) },
        { id: "dup", name: "First" },
        { id: "dup", name: "Second" },
      ]),
    );
    assert.equal(plan.add.length, 1);
    assert.equal(plan.add[0].name, "First");
    assert.deepEqual(
      plan.skipped.map((s) => s.reason),
      ["not-object", "not-object", "missing-name", "too-long", "duplicate"],
    );
  });

  await t.test("newer file copy replaces the local thing", () => {
    const local = makeThing({ id: "a", name: "Old", updatedAt: "2026-01-01T00:00:00.000Z" });
    const file = { ...local, name: "New", updatedAt: "2026-06-01T00:00:00.000Z" };
    const plan = planOf(payloadOf([file]), [local]);
    assert.deepEqual(
      plan.replace.map((x) => x.name),
      ["New"],
    );
    assert.equal(plan.add.length, 0);
    assert.equal(plan.keepLocal.length, 0);
  });

  await t.test("older or equal file copy loses to the local thing", () => {
    const local = makeThing({ id: "a", name: "Local", updatedAt: "2026-06-01T00:00:00.000Z" });
    const older = { ...local, name: "Older", updatedAt: "2026-01-01T00:00:00.000Z" };
    const tie = { ...local, name: "Tie" };

    const olderPlan = planOf(payloadOf([older]), [local]);
    assert.equal(olderPlan.replace.length, 0);
    assert.deepEqual(
      olderPlan.keepLocal.map((x) => x.name),
      ["Older"],
    );

    const tiePlan = planOf(payloadOf([tie]), [local]);
    assert.equal(tiePlan.replace.length, 0);
    assert.deepEqual(
      tiePlan.keepLocal.map((x) => x.name),
      ["Tie"],
    );
  });

  await t.test("keeps only the portable subset of settings", () => {
    const plan = planOf(
      payloadOf([], {
        settings: {
          locale: "ha",
          leadDays: [30, 0, "x", 7],
          dataSaver: false,
          notifyUrgent: false,
          displayName: "  Amina  ",
          managedCategories: ["money", "nope"],
          avatar: "data:image/png;base64,AAAA",
          onboarded: true,
        },
      }),
    );
    assert.ok(plan.settings);
    assert.equal(plan.settings.locale, "ha");
    assert.deepEqual(plan.settings.leadDays, [30, 7]);
    assert.equal(plan.settings.dataSaver, false);
    assert.equal(plan.settings.notifyUrgent, false);
    assert.equal(plan.settings.displayName, "Amina");
    assert.deepEqual(plan.settings.managedCategories, ["money"]);
    // The avatar and onboarding flag are never taken from a file.
    assert.equal("avatar" in plan.settings, false);
    assert.equal("onboarded" in plan.settings, false);
  });

  await t.test("settings are null when the file has none usable", () => {
    assert.equal(planOf(payloadOf([])).settings, null);
    const garbage = planOf(
      payloadOf([], { settings: { locale: "fr", leadDays: [0], avatar: "x" } }),
    );
    assert.equal(garbage.settings, null);
  });

  await t.test("planIsEmpty sees through a plan that changes nothing", () => {
    const empty = planOf(payloadOf([]));
    assert.equal(planIsEmpty(empty), true);
    const withSkips = planOf(payloadOf([null]));
    // Skipped entries alone must not look like a successful import.
    assert.equal(planIsEmpty(withSkips), true);
    const withAdds = planOf(payloadOf([{ id: "z", name: "Z" }]));
    assert.equal(planIsEmpty(withAdds), false);
  });

  await t.test("caps a hostile file at the sane entry limit", () => {
    const flood = Array.from({ length: 5_200 }, (_, i) => ({
      id: `f${i}`,
      name: `F${i}`,
    }));
    const plan = planOf(payloadOf(flood));
    assert.equal(plan.total, 5_200);
    assert.equal(plan.add.length, 5_000);
  });
});

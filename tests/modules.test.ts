import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  soonest,
  summariseAssets,
  summariseBills,
  summariseDocuments,
  summariseHome,
  summariseVehicles,
  warrantyFor,
} from "../lib/modules.ts";
import { assert, iso, makeThing, NOW } from "./helpers.ts";

test("warrantyFor", async (t) => {
  await t.test("returns null without purchase details", () => {
    assert.equal(warrantyFor(makeThing()), null);
  });

  await t.test("returns null with only a purchase date", () => {
    assert.equal(
      warrantyFor(makeThing({ details: { purchasedAt: "2026-01-01" } })),
      null,
    );
  });

  await t.test("computes expiry from purchase date plus months", () => {
    const w = warrantyFor(
      makeThing({ details: { purchasedAt: "2026-01-15", warrantyMonths: 12 } }),
      NOW,
    );
    assert.equal(w?.expiry, "2027-01-15");
  });

  await t.test("keeps the calendar day east of Greenwich", () => {
    // The host timezone cannot be switched mid-run, so exercise the exact
    // condition in a child: local midnight in Lagos is the previous UTC day.
    const script = `
      import { warrantyFor } from "./lib/modules.ts";
      const thing = { details: { purchasedAt: "2026-01-15", warrantyMonths: 12 } };
      process.stdout.write(warrantyFor(thing, new Date("2026-10-03T09:00:00Z"))?.expiry ?? "");
    `;
    const expiry = execFileSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "--import",
        "./tests/register.mjs",
        "--input-type=module",
        "-e",
        script,
      ],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: { ...process.env, TZ: "Africa/Lagos" },
        encoding: "utf8",
      },
    );
    assert.equal(expiry, "2027-01-15");
  });

  await t.test("active when more than 30 days remain", () => {
    const w = warrantyFor(
      makeThing({ details: { purchasedAt: iso(-60), warrantyMonths: 12 } }),
      NOW,
    );
    assert.equal(w?.state, "active");
  });

  await t.test("expiring when 30 days or fewer remain", () => {
    const w = warrantyFor(
      makeThing({ details: { purchasedAt: iso(-400), warrantyMonths: 14 } }),
      NOW,
    );
    assert.equal(w?.state, "expiring");
  });

  await t.test("expired once past the date", () => {
    const w = warrantyFor(
      makeThing({ details: { purchasedAt: iso(-500), warrantyMonths: 12 } }),
      NOW,
    );
    assert.equal(w?.state, "expired");
    assert.ok((w?.daysLeft ?? 0) < 0);
  });
});

test("soonest", async (t) => {
  await t.test("returns null for an empty list", () => {
    assert.equal(soonest([]), null);
  });

  await t.test("picks the earliest dated item", () => {
    const s = soonest([
      makeThing({ id: "b", dueDate: iso(20) }),
      makeThing({ id: "a", dueDate: iso(5) }),
    ]);
    assert.equal(s?.id, "a");
  });

  await t.test("ignores undated items", () => {
    const s = soonest([
      makeThing({ id: "none", dueDate: null }),
      makeThing({ id: "dated", dueDate: iso(5) }),
    ]);
    assert.equal(s?.id, "dated");
  });
});

test("summariseHome", async (t) => {
  await t.test("splits rent from maintenance", () => {
    const s = summariseHome(
      [
        makeThing({ id: "r", category: "home", kind: "rent" }),
        makeThing({ id: "m", category: "home", kind: "maintenance" }),
      ],
      NOW,
    );
    assert.equal(s.properties.length, 1);
    assert.equal(s.maintenance.length, 1);
  });

  await t.test("ignores other categories and inactive things", () => {
    const s = summariseHome(
      [
        makeThing({ id: "a", category: "money", kind: "rent" }),
        makeThing({ id: "b", category: "home", kind: "rent", status: "archived" }),
      ],
      NOW,
    );
    assert.equal(s.properties.length, 0);
  });

  await t.test("sums only amounts due within 30 days", () => {
    const s = summariseHome(
      [
        makeThing({ id: "in", category: "home", kind: "rent", amount: 50_000, dueDate: iso(10) }),
        makeThing({ id: "out", category: "home", kind: "rent", amount: 90_000, dueDate: iso(60) }),
        makeThing({ id: "past", category: "home", kind: "rent", amount: 70_000, dueDate: iso(-5) }),
      ],
      NOW,
    );
    assert.equal(s.monthlyOutgoings, 50_000);
  });

  await t.test("treats a missing amount as zero", () => {
    const s = summariseHome(
      [makeThing({ category: "home", kind: "rent", amount: null, dueDate: iso(3) })],
      NOW,
    );
    assert.equal(s.monthlyOutgoings, 0);
  });

  await t.test("flags maintenance needing urgent or important attention", () => {
    const s = summariseHome(
      [
        makeThing({ id: "now", category: "home", kind: "maintenance", dueDate: iso(2), priority: "urgent" }),
        makeThing({ id: "later", category: "home", kind: "maintenance", dueDate: iso(60), priority: "routine" }),
      ],
      NOW,
    );
    assert.equal(s.overdueMaintenance.length, 1);
    assert.equal(s.overdueMaintenance[0].id, "now");
  });
});

test("summariseVehicles", async (t) => {
  await t.test("groups by the vehicle name in details", () => {
    const groups = summariseVehicles([
      makeThing({ id: "a", category: "transport", kind: "maintenance", details: { vehicle: "Toyota" } }),
      makeThing({ id: "b", category: "transport", kind: "fuel", details: { vehicle: "Toyota" } }),
      makeThing({ id: "c", category: "transport", kind: "maintenance", details: { vehicle: "Honda" } }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups.find((g) => g.name === "Toyota")?.things.length, 2);
  });

  await t.test("falls back to the item name when no vehicle is set", () => {
    const groups = summariseVehicles([
      makeThing({ id: "a", category: "transport", name: "Toyota Camry", details: {} }),
    ]);
    assert.equal(groups[0].name, "Toyota Camry");
  });

  await t.test("ignores non-transport and inactive items", () => {
    const groups = summariseVehicles([
      makeThing({ id: "a", category: "money", details: { vehicle: "Toyota" } }),
      makeThing({ id: "b", category: "transport", status: "archived", details: { vehicle: "Toyota" } }),
    ]);
    assert.equal(groups.length, 0);
  });

  await t.test("totals spend and sorts groups with most service due first", () => {
    const groups = summariseVehicles([
      makeThing({ id: "a", category: "transport", kind: "fuel", amount: 5_000, details: { vehicle: "Honda" } }),
      makeThing({ id: "b", category: "transport", kind: "maintenance", amount: 20_000, priority: "urgent", details: { vehicle: "Toyota" } }),
    ]);
    assert.equal(groups[0].name, "Toyota");
    assert.equal(groups.find((g) => g.name === "Honda")?.totalSpend, 5_000);
  });
});

test("summariseBills", async (t) => {
  await t.test("separates recurring from one-off", () => {
    const s = summariseBills(
      [
        makeThing({ id: "r", category: "money", recurrence: { frequency: "monthly", interval: 1 } }),
        makeThing({ id: "o", category: "money", recurrence: null }),
      ],
      NOW,
    );
    assert.equal(s.recurring.length, 1);
    assert.equal(s.oneOff.length, 1);
  });

  await t.test("sums the recurring total", () => {
    const s = summariseBills(
      [
        makeThing({ id: "a", category: "money", amount: 10_000, recurrence: { frequency: "monthly", interval: 1 } }),
        makeThing({ id: "b", category: "money", amount: 2_500, recurrence: { frequency: "annual", interval: 1 } }),
      ],
      NOW,
    );
    assert.equal(s.recurringTotal, 12_500);
  });

  await t.test("counts only the next 30 days", () => {
    const s = summariseBills(
      [
        makeThing({ id: "in", category: "money", amount: 10_000, dueDate: iso(5) }),
        makeThing({ id: "out", category: "money", amount: 99_000, dueDate: iso(45) }),
      ],
      NOW,
    );
    assert.equal(s.next30Total, 10_000);
  });

  await t.test("reports the largest bill due in the next 30 days", () => {
    const s = summariseBills(
      [
        makeThing({ id: "a", category: "money", amount: 10_000, dueDate: iso(5) }),
        makeThing({ id: "b", category: "money", amount: 45_000, dueDate: iso(2) }),
      ],
      NOW,
    );
    assert.equal(s.largest?.id, "b");
  });

  await t.test("largest is null when nothing is due soon", () => {
    const s = summariseBills(
      [makeThing({ category: "money", amount: 45_000, dueDate: iso(60) })],
      NOW,
    );
    assert.equal(s.largest, null);
  });
});

test("summariseDocuments", async (t) => {
  await t.test("buckets overdue and soon into expiring", () => {
    const s = summariseDocuments(
      [
        makeThing({ id: "a", category: "documents", kind: "document", dueDate: iso(-5) }),
        makeThing({ id: "b", category: "documents", kind: "document", dueDate: iso(20) }),
      ],
      NOW,
    );
    assert.equal(s.expiringSoon.length, 2);
  });

  await t.test("buckets later-this-year separately", () => {
    const s = summariseDocuments(
      [makeThing({ category: "documents", kind: "document", dueDate: "2026-11-30" })],
      NOW,
    );
    assert.equal(s.thisYear.length, 1);
    assert.equal(s.later.length, 0);
  });

  await t.test("buckets next year into later", () => {
    const s = summariseDocuments(
      [makeThing({ category: "documents", kind: "document", dueDate: "2027-02-01" })],
      NOW,
    );
    assert.equal(s.later.length, 1);
  });

  await t.test("buckets undated documents", () => {
    const s = summariseDocuments(
      [makeThing({ category: "documents", kind: "document", dueDate: null })],
      NOW,
    );
    assert.equal(s.noExpiry.length, 1);
  });

  await t.test("includes non-document kinds in this category", () => {
    const s = summariseDocuments(
      [makeThing({ category: "documents", kind: "reminder", dueDate: iso(5) })],
      NOW,
    );
    assert.equal(s.expiringSoon.length, 1);
  });

  await t.test("leaves assets to the assets module", () => {
    const s = summariseDocuments(
      [makeThing({ category: "documents", kind: "asset", dueDate: iso(5) })],
      NOW,
    );
    assert.equal(s.expiringSoon.length, 0);
    assert.equal(s.noExpiry.length, 0);
  });
});

test("summariseAssets", async (t) => {
  const withWarranty = (id: string, purchasedAt: string, months: number) =>
    makeThing({ id, kind: "asset", details: { purchasedAt, warrantyMonths: months } });

  await t.test("splits rows by warranty state", () => {
    const s = summariseAssets(
      [
        withWarranty("ok", iso(-60), 12),
        withWarranty("soon", iso(-400), 14),
        withWarranty("gone", iso(-500), 12),
      ],
      NOW,
    );
    assert.equal(s.covered.length, 1);
    assert.equal(s.expiring.length, 1);
    assert.equal(s.expired.length, 1);
  });

  await t.test("keeps assets with no warranty in rows only", () => {
    const s = summariseAssets([makeThing({ id: "bare", kind: "asset", details: {} })], NOW);
    assert.equal(s.rows.length, 1);
    assert.equal(s.rows[0].warranty, null);
    assert.equal(s.covered.length, 0);
  });

  await t.test("totals asset value treating missing amounts as zero", () => {
    const s = summariseAssets(
      [
        makeThing({ id: "a", kind: "asset", amount: 500_000, details: {} }),
        makeThing({ id: "b", kind: "asset", amount: null, details: {} }),
      ],
      NOW,
    );
    assert.equal(s.totalValue, 500_000);
  });

  await t.test("ignores inactive assets", () => {
    const s = summariseAssets(
      [makeThing({ kind: "asset", status: "archived", amount: 500_000, details: {} })],
      NOW,
    );
    assert.equal(s.rows.length, 0);
    assert.equal(s.totalValue, 0);
  });
});
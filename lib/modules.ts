import { daysUntil } from "./risk.ts";
import { amountOrZero } from "./money.ts";
import { parseISO, toISO } from "./dates.ts";
import type { Thing } from "./types.ts";

/* ---------------- warranty ---------------- */

export interface Warranty {
  purchasedAt: string;
  months: number;
  expiry: string;
  daysLeft: number;
  state: "active" | "expiring" | "expired";
}

function addMonths(iso: string, months: number): string {
  // Local components: toISOString shifts a local-midnight day back east of UTC.
  const d = parseISO(iso);
  d.setMonth(d.getMonth() + months);
  return toISO(d);
}

export function warrantyFor(
  thing: Thing,
  now: Date = new Date(),
): Warranty | null {
  const purchasedAt = thing.details.purchasedAt;
  const months = thing.details.warrantyMonths;
  if (typeof purchasedAt !== "string" || typeof months !== "number") return null;

  const expiry = addMonths(purchasedAt, months);
  const daysLeft = daysUntil(expiry, now);

  return {
    purchasedAt,
    months,
    expiry,
    daysLeft,
    state: daysLeft < 0 ? "expired" : daysLeft <= 30 ? "expiring" : "active",
  };
}

/* ---------------- shared ---------------- */

export function isActive(t: Thing): boolean {
  return t.status === "active";
}

export function soonest(list: Thing[]): Thing | null {
  const dated = list
    .filter((t) => t.dueDate)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  return dated[0] ?? null;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/* ---------------- home ---------------- */

export interface HomeSummary {
  properties: Thing[];
  maintenance: Thing[];
  overdueMaintenance: Thing[];
  other: Thing[];
  monthlyOutgoings: number;
}

export function summariseHome(things: Thing[], now: Date = new Date()): HomeSummary {
  const home = things.filter(
    (t) => t.category === "home" && t.kind !== "asset" && isActive(t),
  );
  const rent = home.filter((t) => t.kind === "rent");
  const maintenance = home.filter((t) => t.kind === "maintenance");
  const other = home.filter((t) => t.kind !== "rent" && t.kind !== "maintenance");

  const HORIZON = 30;
  const monthly = things.filter((t) => {
    if (!isActive(t) || !t.dueDate) return false;
    const d = daysUntil(t.dueDate, now);
    return d >= 0 && d <= HORIZON;
  });

  return {
    properties: rent,
    maintenance,
    overdueMaintenance: maintenance.filter(
      (m) => m.priority === "urgent" || m.priority === "important",
    ),
    other,
    monthlyOutgoings: monthly.reduce((s, t) => s + amountOrZero(t.amount), 0),
  };
}

/* ---------------- vehicles ---------------- */

export interface VehicleGroup {
  name: string;
  things: Thing[];
  serviceDue: Thing[];
  totalSpend: number;
  nextDue: Thing | null;
}

export function summariseVehicles(things: Thing[]): VehicleGroup[] {
  const transport = things.filter(
    (t) => t.category === "transport" && t.kind !== "asset" && isActive(t),
  );

  const groups = groupBy(
    transport,
    (t) => (typeof t.details.vehicle === "string" ? t.details.vehicle : t.name),
  );

  const out: VehicleGroup[] = [];
  for (const [name, items] of groups) {
    out.push({
      name,
      things: items,
      serviceDue: items.filter(
        (i) => i.kind === "maintenance" && i.priority !== "routine",
      ),
      totalSpend: items.reduce((s, i) => s + amountOrZero(i.amount), 0),
      nextDue: soonest(items),
    });
  }

  return out.sort((a, b) => b.serviceDue.length - a.serviceDue.length);
}

/* ---------------- bills ---------------- */

export interface BillsSummary {
  recurring: Thing[];
  oneOff: Thing[];
  recurringTotal: number;
  next30Total: number;
  largest: Thing | null;
}

export function summariseBills(things: Thing[], now: Date = new Date()): BillsSummary {
  const money = things.filter(
    (t) => t.category === "money" && t.kind !== "asset" && isActive(t),
  );
  const recurring = money.filter((t) => t.recurrence !== null);
  const oneOff = money.filter((t) => t.recurrence === null);

  const HORIZON = 30;
  const next30 = money.filter((t) => {
    if (!t.dueDate) return false;
    const d = daysUntil(t.dueDate, now);
    return d >= 0 && d <= HORIZON;
  });

  const withAmount = next30.filter((t) => amountOrZero(t.amount) > 0);
  const largest = withAmount.sort(
    (a, b) => amountOrZero(b.amount) - amountOrZero(a.amount),
  )[0];

  return {
    recurring: recurring.sort((a, b) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? ""),
    ),
    oneOff,
    recurringTotal: recurring.reduce((s, t) => s + amountOrZero(t.amount), 0),
    next30Total: next30.reduce((s, t) => s + amountOrZero(t.amount), 0),
    largest: largest ?? null,
  };
}

/* ---------------- documents ---------------- */

export interface DocumentsSummary {
  expiringSoon: Thing[];
  thisYear: Thing[];
  later: Thing[];
  noExpiry: Thing[];
}

export function summariseDocuments(
  things: Thing[],
  now: Date = new Date(),
): DocumentsSummary {
  const docs = things.filter(
    (t) => t.category === "documents" && t.kind !== "asset" && isActive(t),
  );

  const endOfYear = new Date(now.getFullYear(), 11, 31);
  const expiringSoon: Thing[] = [];
  const thisYear: Thing[] = [];
  const later: Thing[] = [];
  const noExpiry: Thing[] = [];

  for (const doc of docs) {
    if (!doc.dueDate) {
      noExpiry.push(doc);
      continue;
    }
    const d = daysUntil(doc.dueDate, now);
    if (d < 0 || d <= 30) expiringSoon.push(doc);
    else if (new Date(`${doc.dueDate}T00:00:00`) <= endOfYear) thisYear.push(doc);
    else later.push(doc);
  }

  const byDate = (a: Thing, b: Thing) =>
    (a.dueDate ?? "").localeCompare(b.dueDate ?? "");

  return {
    expiringSoon: expiringSoon.sort(byDate),
    thisYear: thisYear.sort(byDate),
    later: later.sort(byDate),
    noExpiry,
  };
}

/* ---------------- assets ---------------- */

export interface AssetRow {
  thing: Thing;
  warranty: Warranty | null;
}

export interface AssetsSummary {
  rows: AssetRow[];
  expiring: AssetRow[];
  expired: AssetRow[];
  covered: AssetRow[];
  totalValue: number;
}

export function summariseAssets(things: Thing[], now: Date = new Date()): AssetsSummary {
  const assets = things.filter((t) => t.kind === "asset" && isActive(t));

  const rows: AssetRow[] = assets.map((thing) => ({
    thing,
    warranty: warrantyFor(thing, now),
  }));

  return {
    rows,
    expiring: rows.filter((r) => r.warranty?.state === "expiring"),
    expired: rows.filter((r) => r.warranty?.state === "expired"),
    covered: rows.filter((r) => r.warranty?.state === "active"),
    totalValue: assets.reduce((s, t) => s + amountOrZero(t.amount), 0),
  };
}
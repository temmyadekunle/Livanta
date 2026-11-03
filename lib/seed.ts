import { buildAlerts, derivePriority } from "./risk.ts";
import { anonymousStore, newId, type LocalStore } from "./db.ts";
import type { HouseholdMember, Thing } from "./types.ts";

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function past(daysAgo: number): string {
  return iso(-daysAgo);
}

type Seed = Omit<Thing, "id" | "createdAt" | "updatedAt" | "currency">;

function make(seed: Seed): Thing {
  const now = new Date().toISOString();
  const thing: Thing = {
    ...seed,
    id: newId(),
    currency: "NGN",
    createdAt: now,
    updatedAt: now,
  };
  thing.priority = derivePriority(thing);
  return thing;
}

export const SEED_THINGS: Seed[] = [
  {
    name: "Rent",
    category: "home",
    kind: "rent",
    amount: 1_200_000,
    dueDate: iso(18),
    lastHandledDate: null,
    recurrence: { frequency: "annual", interval: 1 },
    serviceIntervalDays: null,
    status: "active",
    priority: "upcoming",
    notes: "Pay before the 25th to avoid a late fee.",
    details: { landlord: "Mr. Okonkwo", serviceCharge: 150_000, securityFee: 50_000 },
  },
  {
    name: "Electricity",
    category: "money",
    kind: "utility",
    amount: 45_200,
    dueDate: iso(1),
    lastHandledDate: null,
    recurrence: { frequency: "monthly", interval: 1 },
    serviceIntervalDays: null,
    status: "active",
    priority: "urgent",
    notes: null,
    details: { provider: "Ikeja Electric" },
  },
  {
    name: "Internet subscription",
    category: "money",
    kind: "subscription",
    amount: 20_000,
    dueDate: iso(3),
    lastHandledDate: null,
    recurrence: { frequency: "monthly", interval: 1 },
    serviceIntervalDays: null,
    status: "active",
    priority: "urgent",
    notes: "Spectranet 10GB + 4G router",
    details: { provider: "Spectranet" },
  },
  {
    name: "Netflix",
    category: "money",
    kind: "subscription",
    amount: 8_500,
    dueDate: iso(6),
    lastHandledDate: null,
    recurrence: { frequency: "monthly", interval: 1 },
    serviceIntervalDays: null,
    status: "active",
    priority: "urgent",
    notes: null,
    details: { provider: "Netflix" },
  },
  {
    name: "Vehicle insurance",
    category: "transport",
    kind: "insurance",
    amount: 85_000,
    dueDate: iso(12),
    lastHandledDate: null,
    recurrence: { frequency: "annual", interval: 1 },
    serviceIntervalDays: null,
    status: "active",
    priority: "important",
    notes: null,
    details: { vehicle: "Toyota Camry", plateNumber: "ABC-123-Lagos" },
  },
  {
    name: "Driver's licence",
    category: "documents",
    kind: "document",
    amount: null,
    dueDate: iso(45),
    lastHandledDate: null,
    recurrence: null,
    serviceIntervalDays: null,
    status: "active",
    priority: "important",
    notes: "Renew at any FRSC office.",
    details: { issuer: "FRSC", licenceNumber: "NG-8821-L" },
  },
  {
    name: "Passport",
    category: "documents",
    kind: "document",
    amount: null,
    dueDate: iso(240),
    lastHandledDate: null,
    recurrence: null,
    serviceIntervalDays: null,
    status: "active",
    priority: "routine",
    notes: null,
    details: { issuer: "NIS", passportNumber: "A0981234" },
  },
  {
    name: "Generator service",
    category: "home",
    kind: "maintenance",
    amount: 45_000,
    dueDate: null,
    lastHandledDate: past(120),
    recurrence: null,
    serviceIntervalDays: 90,
    status: "active",
    priority: "important",
    notes: "Last serviced 4 months ago.",
    details: { asset: "Generator", provider: "Emeka" },
  },
  {
    name: "Toyota Camry oil change",
    category: "transport",
    kind: "maintenance",
    amount: 30_000,
    dueDate: null,
    lastHandledDate: past(200),
    recurrence: null,
    serviceIntervalDays: 120,
    status: "active",
    priority: "important",
    notes: null,
    details: { vehicle: "Toyota Camry", plateNumber: "ABC-123-Lagos" },
  },
  {
    name: "School fees",
    category: "family",
    kind: "school-fee",
    amount: 150_000,
    dueDate: iso(14),
    lastHandledDate: null,
    recurrence: { frequency: "biannual", interval: 1 },
    serviceIntervalDays: null,
    status: "active",
    priority: "important",
    notes: "Assigned to Partner.",
    details: { child: "Chidi", school: "Command Primary", assignedTo: "Partner" },
  },
  {
    name: "LG Refrigerator",
    category: "home",
    kind: "asset",
    amount: 465_000,
    dueDate: iso(21),
    lastHandledDate: null,
    recurrence: null,
    serviceIntervalDays: null,
    status: "active",
    priority: "urgent",
    notes: "12-month warranty, expires soon.",
    details: {
      brand: "LG",
      serialNumber: "LG-9938-KL",
      warrantyMonths: 12,
      purchasedAt: past(344),
    },
  },
  {
    name: "John the electrician",
    category: "services",
    kind: "service-provider",
    amount: null,
    dueDate: null,
    lastHandledDate: past(45),
    recurrence: null,
    serviceIntervalDays: null,
    status: "active",
    priority: "routine",
    notes: "Reliable, fixes fast.",
    details: { trade: "Electrician", phone: "08000000001", rating: 5 },
  },
];

export const SEED_MEMBERS: HouseholdMember[] = [
  {
    id: "member-owner",
    name: "Temmy Adekunle",
    role: "owner",
    createdAt: new Date().toISOString(),
  },
];

// The no-store overload preserves legacy calls; explicit stores never fall back.
export function seedIfEmpty(): Promise<Thing[]>;
export function seedIfEmpty(store: LocalStore): Promise<Thing[]>;
export async function seedIfEmpty(...args: [] | [store: LocalStore]): Promise<Thing[]> {
  const store = args.length === 0 ? anonymousStore : args[0];
  const existing = await store.getAllThings();
  if (existing.length > 0) return existing;

  const things = SEED_THINGS.map(make);
  for (const thing of things) await store.putThing(thing);

  for (const member of SEED_MEMBERS) await store.putMember(member);

  const alerts = buildAlerts(things);
  for (const alert of alerts) await store.putAlert(alert);

  return things;
}
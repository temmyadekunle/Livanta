/**
 * Safe import of a Livanta export file.
 *
 * An export (see exportPayload) is `{ app, version, exportedAt, settings,
 * things }`. Everything read back is untrusted: the file may have been edited
 * by hand, produced by an older or newer app, or be arbitrary JSON with the
 * right label. This module therefore never throws on bad content and never
 * writes anything itself — it returns a plan the UI previews, and only an
 * explicit confirmation hands that plan to the app to apply. Cancelling at
 * the preview leaves the store untouched.
 *
 * Field policy, deliberately asymmetric:
 *   - Structural lies (an entry that is not an object, has no usable name)
 *     are skipped with the reason shown in the preview, because such an entry
 *     cannot be displayed or edited at all.
 *   - Cosmetic lies (unknown category/kind/status, malformed due date or
 *     amount) are repaired to safe defaults and counted as adjusted, because
 *     dropping someone's rent over a typo'd category is worse than filing it
 *     under Tasks.
 *   - Conflicts (same id as a local thing): the copy with the newer
 *     `updatedAt` wins; ties keep the local copy. The preview reports which
 *     way each conflict will go.
 *   - Settings are opt-in at confirm time and limited to the portable subset:
 *     locale, leadDays, notifyUrgent, dataSaver, managedCategories,
 *     displayName. The avatar is never imported (a picture smuggled inside a
 *     JSON file is a rendering vector, and loadSettings re-checks its shape
 *     anyway), and onboarding state and anything auth-related are untouched.
 *   - Priority is recomputed locally rather than trusted; currency is always
 *     pinned to NGN; a hostile file cannot exceed MAX_IMPORT_THINGS entries.
 */
import { parseISO, toISO } from "./dates.ts";
import { isLocale, type Locale } from "./i18n.ts";
import { derivePriority } from "./risk.ts";
import type { Settings } from "./settings.ts";
import type { Category, Frequency, Status, Thing, ThingKind } from "./types.ts";

/** Exhaustive maps so a new union member cannot be forgotten silently. */
const CATEGORIES: Record<Category, true> = {
  home: true,
  transport: true,
  money: true,
  documents: true,
  family: true,
  tasks: true,
  services: true,
};

const KINDS: Record<ThingKind, true> = {
  rent: true,
  utility: true,
  bill: true,
  subscription: true,
  "school-fee": true,
  vehicle: true,
  fuel: true,
  maintenance: true,
  insurance: true,
  document: true,
  asset: true,
  appointment: true,
  reminder: true,
  "service-provider": true,
  task: true,
  birthday: true,
  "important-date": true,
};

const STATUSES: Record<Status, true> = {
  active: true,
  completed: true,
  archived: true,
};

const FREQUENCIES: Record<Frequency, true> = {
  none: true,
  weekly: true,
  biweekly: true,
  monthly: true,
  quarterly: true,
  biannual: true,
  annual: true,
};

const MAX_NAME = 200;
const MAX_NOTES = 2_000;
const MAX_THINGS = 5_000;
const MAX_LEADS = 6;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export type ImportSkipReason =
  | "not-object"
  | "missing-name"
  | "too-long"
  | "duplicate";

export interface ImportSkip {
  /** Position in the file's things array, for pointing at the offender. */
  index: number;
  id: string | null;
  name: string | null;
  reason: ImportSkipReason;
}

export interface ImportPlan {
  /** Sanitised things that do not exist locally and will be created. */
  add: Thing[];
  /** Local things that a newer copy from the file will overwrite. */
  replace: Thing[];
  /** File copies that lose to a newer local thing and will be ignored. */
  keepLocal: Thing[];
  skipped: ImportSkip[];
  /** How many kept entries needed at least one repair. */
  adjusted: number;
  /** Portable settings from the file, or null when absent/unusable. */
  settings: Partial<Settings> | null;
  /** Entries seen in the file (before the sanity cap). */
  total: number;
}

export type ImportParseResult =
  | { ok: true; plan: ImportPlan }
  | {
      ok: false;
      error: "invalid-json" | "not-livanta" | "unsupported-version" | "not-array";
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A calendar day that actually exists, checked by round-tripping it. */
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return toISO(parseISO(value)) === value;
}

function validDatetime(value: unknown): value is string {
  return typeof value === "string" && ISO_DATETIME.test(value) && !Number.isNaN(Date.parse(value));
}

function sanitizeThing(
  raw: unknown,
  nowIso: string,
): { thing: Thing | null; adjusted: boolean; skip?: ImportSkipReason } {
  if (!isPlainObject(raw)) return { thing: null, adjusted: false, skip: "not-object" };

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { thing: null, adjusted: false, skip: "missing-name" };
  if (name.length > MAX_NAME) return { thing: null, adjusted: false, skip: "too-long" };

  let adjusted = false;
  const repair = (): true => {
    adjusted = true;
    return true;
  };

  let id: string;
  if (typeof raw.id === "string" && raw.id.trim()) {
    id = raw.id.trim();
  } else {
    repair();
    id = makeId();
  }

  let category: Category = "tasks";
  if (typeof raw.category === "string" && raw.category in CATEGORIES) {
    category = raw.category as Category;
  } else {
    repair();
  }

  let kind: ThingKind = "reminder";
  if (typeof raw.kind === "string" && raw.kind in KINDS) {
    kind = raw.kind as ThingKind;
  } else {
    repair();
  }

  let status: Status = "active";
  if (raw.status !== undefined) {
    if (typeof raw.status === "string" && raw.status in STATUSES) {
      status = raw.status as Status;
    } else {
      repair();
    }
  }

  let amount: number | null = null;
  if (raw.amount !== undefined && raw.amount !== null) {
    if (typeof raw.amount === "number" && Number.isFinite(raw.amount) && raw.amount >= 0) {
      amount = raw.amount;
    } else {
      repair();
    }
  }

  let dueDate: string | null = null;
  if (raw.dueDate !== undefined && raw.dueDate !== null) {
    if (validDate(raw.dueDate)) dueDate = raw.dueDate;
    else repair();
  }

  let lastHandledDate: string | null = null;
  if (raw.lastHandledDate !== undefined && raw.lastHandledDate !== null) {
    if (validDate(raw.lastHandledDate)) lastHandledDate = raw.lastHandledDate;
    else repair();
  }

  let recurrence: Thing["recurrence"] = null;
  if (raw.recurrence !== undefined && raw.recurrence !== null) {
    if (isPlainObject(raw.recurrence)) {
      const frequency = raw.recurrence.frequency;
      if (typeof frequency === "string" && frequency in FREQUENCIES && frequency !== "none") {
        const intervalRaw = raw.recurrence.interval;
        const interval =
          typeof intervalRaw === "number" && Number.isFinite(intervalRaw) && intervalRaw >= 1
            ? Math.floor(intervalRaw)
            : 1;
        recurrence = { frequency: frequency as Frequency, interval };
      } else {
        repair();
      }
    } else {
      repair();
    }
  }

  let serviceIntervalDays: number | null = null;
  if (raw.serviceIntervalDays !== undefined && raw.serviceIntervalDays !== null) {
    const n = raw.serviceIntervalDays;
    if (typeof n === "number" && Number.isFinite(n) && n >= 1) {
      serviceIntervalDays = Math.floor(n);
    } else {
      repair();
    }
  }

  let notes: string | null = null;
  if (typeof raw.notes === "string" && raw.notes.trim()) {
    notes = raw.notes.trim().slice(0, MAX_NOTES);
  }

  let details: Record<string, unknown> = {};
  if (raw.details !== undefined && raw.details !== null) {
    if (isPlainObject(raw.details)) details = raw.details;
    else repair();
  }

  const thing: Thing = {
    id,
    name,
    category,
    kind,
    amount,
    currency: "NGN",
    dueDate,
    lastHandledDate,
    recurrence,
    serviceIntervalDays,
    status,
    // Never trust a stored priority: it is derived from dates the file may
    // have rewritten.
    priority: "routine",
    notes,
    details,
    createdAt: validDatetime(raw.createdAt) ? raw.createdAt : nowIso,
    updatedAt: validDatetime(raw.updatedAt) ? raw.updatedAt : nowIso,
  };
  thing.priority = derivePriority(thing);

  return { thing, adjusted };
}

function sanitizeSettings(raw: unknown): Partial<Settings> | null {
  if (!isPlainObject(raw)) return null;
  const out: Partial<Settings> = {};

  if (typeof raw.displayName === "string" && raw.displayName.trim()) {
    out.displayName = raw.displayName.trim().slice(0, MAX_NAME);
  }
  if (typeof raw.locale === "string" && isLocale(raw.locale)) {
    out.locale = raw.locale as Locale;
  }
  if (typeof raw.dataSaver === "boolean") out.dataSaver = raw.dataSaver;
  if (typeof raw.notifyUrgent === "boolean") out.notifyUrgent = raw.notifyUrgent;
  if (Array.isArray(raw.leadDays)) {
    const leads = [
      ...new Set(
        raw.leadDays
          .filter(
            (n): n is number =>
              typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 365,
          )
          .map((n) => Math.floor(n)),
      ),
    ]
      .sort((a, b) => b - a)
      .slice(0, MAX_LEADS);
    if (leads.length > 0) out.leadDays = leads;
  }
  if (Array.isArray(raw.managedCategories)) {
    const managed = raw.managedCategories.filter(
      (c): c is Category => typeof c === "string" && c in CATEGORIES,
    );
    if (managed.length > 0) out.managedCategories = managed;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `import-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export interface ParseImportOptions {
  /** What is already on the device; drives conflict resolution. */
  existing?: Thing[];
  /** Injectable clock so tests can pin "now". */
  now?: Date;
}

export function parseImport(text: string, opts: ParseImportOptions = {}): ImportParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid-json" };
  }

  if (!isPlainObject(payload) || payload.app !== "Livanta") {
    return { ok: false, error: "not-livanta" };
  }
  if (payload.version !== 1) {
    return { ok: false, error: "unsupported-version" };
  }
  if (!Array.isArray(payload.things)) {
    return { ok: false, error: "not-array" };
  }

  const nowIso = (opts.now ?? new Date()).toISOString();
  const total = payload.things.length;
  const seenIds = new Set<string>();
  const existingById = new Map((opts.existing ?? []).map((t) => [t.id, t]));

  const plan: ImportPlan = {
    add: [],
    replace: [],
    keepLocal: [],
    skipped: [],
    adjusted: 0,
    settings: sanitizeSettings(payload.settings),
    total,
  };

  const entries = payload.things.slice(0, MAX_THINGS);
  for (const [index, raw] of entries.entries()) {
    const { thing, adjusted, skip } = sanitizeThing(raw, nowIso);
    if (!thing) {
      plan.skipped.push({
        index,
        id: isPlainObject(raw) && typeof raw.id === "string" ? raw.id : null,
        name: isPlainObject(raw) && typeof raw.name === "string" ? raw.name : null,
        reason: skip ?? "not-object",
      });
      continue;
    }
    // A repeated id inside the file itself: the first copy wins, later ones
    // are skipped rather than silently overwriting each other.
    if (seenIds.has(thing.id)) {
      plan.skipped.push({
        index,
        id: thing.id,
        name: thing.name,
        reason: "duplicate",
      });
      continue;
    }
    seenIds.add(thing.id);
    if (adjusted) plan.adjusted += 1;

    const local = existingById.get(thing.id);
    if (!local) {
      plan.add.push(thing);
    } else if (thing.updatedAt > local.updatedAt) {
      plan.replace.push(thing);
    } else {
      plan.keepLocal.push(thing);
    }
  }

  return { ok: true, plan };
}

/** True when the plan would not change anything on this device. */
export function planIsEmpty(plan: ImportPlan): boolean {
  return plan.add.length === 0 && plan.replace.length === 0;
}

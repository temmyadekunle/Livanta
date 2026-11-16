"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildAlerts, daysUntil, derivePriority, formatNaira } from "./risk.ts";
import { nextOccurrence, toISO } from "./dates.ts";
import type { ImportPlan } from "./import.ts";
import { amountOrZero } from "./money.ts";
import { computeLifeStatus } from "./status.ts";
import { anonymousStore, type LocalStore } from "./db.ts";
import { recordDeletion, recordDismissal } from "./sync/meta.ts";
import { seedIfEmpty } from "./seed.ts";
import { makeT } from "./i18n.ts";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "./settings.ts";
import type { Alert, Category, Thing, ThingKind } from "./types.ts";

export interface NewThingInput {
  name: string;
  category: Category;
  kind: ThingKind;
  amount?: number | null;
  dueDate?: string | null;
  recurrence?: Thing["recurrence"];
  serviceIntervalDays?: number | null;
  notes?: string | null;
  details?: Record<string, unknown>;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface LocalSnapshot {
  settings: Settings;
  things: Thing[];
  dismissedIds: Set<string>;
}

interface LocalState extends LocalSnapshot {
  /** The store that produced this state; null before the first load. */
  scope: LocalStore | null;
  ready: boolean;
  loading: boolean;
  error: string | null;
}

const NO_THINGS: Thing[] = [];
const NO_DISMISSED_IDS = new Set<string>();

async function readLocalSnapshot(store: LocalStore): Promise<LocalSnapshot> {
  const [settings, things, alerts] = await Promise.all([
    loadSettings(store),
    store.getAllThings(),
    store.getAllAlerts(),
  ]);
  return {
    settings,
    things,
    dismissedIds: new Set(
      alerts.filter((alert) => alert.dismissed).map((alert) => alert.id),
    ),
  };
}

function databaseErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Could not open the local database.";
}

/**
 * The local-data hook. An explicit store is used for every read and write and
 * is never replaced by the anonymous database. Passing an explicit `null`
 * store selects idle behaviour: no database is opened, no default anonymous
 * substitution occurs, and every operation is idle-safe.
 *
 * Operations capture the store they started with, so a scope change cannot
 * redirect an in-flight write. A generation token prevents any late completion
 * from publishing data for the previous store into the current UI.
 *
 * A render-time owner guard compares the store's scope with `expectedUserId`.
 * A mismatch exposes no account records and produces a recoverable scope
 * error instead of a silent fallback or a second account's data.
 */
export function useLivanta(
  ...args: [] | [store: LocalStore | null, expectedUserId?: string | null]
) {
  const explicitStore = args.length > 0;
  const store = args.length === 0 ? anonymousStore : args[0];
  const expectedUserId = args.length >= 2 ? args[1] : null;

  // Render-time owner guard: an explicit store whose scope does not match the
  // expected user id must never expose account records.
  const ownerMismatch =
    explicitStore &&
    store !== null &&
    store.scope.kind === "user" &&
    expectedUserId !== null &&
    store.scope.userId !== expectedUserId;

  const [local, setLocal] = useState<LocalState>(() => ({
    scope: null,
    settings: DEFAULT_SETTINGS,
    things: NO_THINGS,
    dismissedIds: NO_DISMISSED_IDS,
    ready: false,
    loading: true,
    error: null,
  }));
  const generationRef = useRef(0);
  /** Set true when this hook's store has been closed/released. All mutation
     paths reject while invalidated, so pending operations from a previous
     account cannot write after an identity transition. */
  const invalidatedRef = useRef(false);

  // State belongs to the store that loaded it. Rendering for a different store
  // immediately hides the old scope instead of waiting for the effect to reset.
  const current = local.scope === store;
  const things = current ? local.things : NO_THINGS;
  const dismissedIds = current ? local.dismissedIds : NO_DISMISSED_IDS;
  const settings = ownerMismatch
    ? DEFAULT_SETTINGS
    : current
      ? local.settings
      : DEFAULT_SETTINGS;
  const ready = ownerMismatch ? false : (current && local.ready);
  const loading = ownerMismatch ? false : (current ? local.loading : true);
  const error = ownerMismatch
    ? "The local database belongs to a different account. Sign in again to continue."
    : current ? local.error : null;

  const loadAndApply = useCallback(
    async (target: LocalStore, generation: number) => {
      const snapshot = await readLocalSnapshot(target);
      if (generationRef.current !== generation) return;
      setLocal((previous) => ({
        ...previous,
        scope: target,
        ...snapshot,
      }));
    },
    [],
  );

  const hydrate = useCallback(
    async (target: LocalStore, generation: number, fresh = false) => {
      try {
        const snapshot = await readLocalSnapshot(target);
        if (generationRef.current !== generation) return;
        setLocal({
          scope: target,
          ...snapshot,
          ready: true,
          loading: false,
          error: null,
        });
      } catch (e) {
        if (generationRef.current !== generation) return;
        setLocal((previous) => {
          const message = databaseErrorMessage(e);
          if (fresh || previous.scope !== target) {
            return {
              scope: target,
              settings: DEFAULT_SETTINGS,
              things: NO_THINGS,
              dismissedIds: NO_DISMISSED_IDS,
              ready: true,
              loading: false,
              error: message,
            };
          }
          return { ...previous, ready: true, loading: false, error: message };
        });
      }
    },
    [],
  );

  // Null store: idle behaviour. No database is opened, no anonymous fallback,
  // and the desk is ready immediately so the surface decision can progress.
  useEffect(() => {
    if (store === null) {
      setLocal({
        scope: null,
        settings: DEFAULT_SETTINGS,
        things: NO_THINGS,
        dismissedIds: NO_DISMISSED_IDS,
        ready: true,
        loading: false,
        error: null,
      });
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    void hydrate(store, generation, true);
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [store, hydrate]);

  const refresh = useCallback(async () => {
    if (store === null || ownerMismatch || invalidatedRef.current) return;
    await hydrate(store, generationRef.current);
  }, [store, hydrate, ownerMismatch]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    if (store === null || ownerMismatch || invalidatedRef.current) return;
    const generation = generationRef.current;
    const next = { ...settings, ...patch };
    if (generationRef.current === generation) {
      setLocal((previous) =>
        previous.scope === store ? { ...previous, settings: next } : previous,
      );
    }
    if (invalidatedRef.current) return;
    await saveSettings(store, next);
  }, [settings, store, ownerMismatch]);

  const completeOnboarding = useCallback(
    async (input: {
      categories: Settings["managedCategories"];
      firstThings: {
        name: string;
        category: Category;
        kind: ThingKind;
        dueDate: string;
      }[];
      locale?: Settings["locale"];
    }) => {
      if (store === null || ownerMismatch || invalidatedRef.current) return;
      const generation = generationRef.current;
      const next: Settings = {
        ...settings,
        onboarded: true,
        managedCategories: input.categories,
        locale: input.locale ?? settings.locale,
      };
      if (generationRef.current === generation) {
        setLocal((previous) =>
          previous.scope === store ? { ...previous, settings: next } : previous,
        );
      }
      if (invalidatedRef.current) return;
      await saveSettings(store, next);

      const now = new Date().toISOString();
      for (const first of input.firstThings) {
        if (invalidatedRef.current) return;
        const thing: Thing = {
          id: makeId(),
          name: first.name,
          category: first.category,
          kind: first.kind,
          amount: null,
          currency: "NGN",
          dueDate: first.dueDate || null,
          lastHandledDate: null,
          recurrence: null,
          serviceIntervalDays: null,
          status: "active",
          priority: "routine",
          notes: null,
          details: {},
          createdAt: now,
          updatedAt: now,
        };
        thing.priority = derivePriority(thing);
        await store.putThing(thing);
      }

      if (invalidatedRef.current) return;
      await loadAndApply(store, generation);
    },
    [settings, store, loadAndApply, ownerMismatch],
  );

  const loadSampleData = useCallback(async () => {
    if (store === null || ownerMismatch || invalidatedRef.current) return;
    const generation = generationRef.current;
    if (invalidatedRef.current) return;
    await seedIfEmpty(store);
    if (invalidatedRef.current) return;
    await loadAndApply(store, generation);
  }, [store, loadAndApply, ownerMismatch]);

  const deleteEverything = useCallback(async () => {
    if (store === null || ownerMismatch || invalidatedRef.current) return;
    const generation = generationRef.current;
    if (invalidatedRef.current) return;
    await store.clear();
    const fresh = { ...DEFAULT_SETTINGS };
    if (generationRef.current === generation) {
      setLocal((previous) =>
        previous.scope === store ? { ...previous, settings: fresh } : previous,
      );
    }
    if (invalidatedRef.current) return;
    await saveSettings(store, fresh);
    if (generationRef.current === generation) {
      setLocal((previous) =>
        previous.scope === store
          ? { ...previous, things: NO_THINGS, dismissedIds: NO_DISMISSED_IDS }
          : previous,
      );
    }
  }, [store, ownerMismatch]);

  const t = useMemo(() => makeT(settings.locale), [settings.locale]);

  const alerts = useMemo(() => {
    const built = buildAlerts(things, new Date(), t);
    return built.filter((a) => !dismissedIds.has(a.id));
  }, [things, dismissedIds, t]);

  const status = useMemo(
    () => computeLifeStatus(things, alerts, new Date(), t),
    [things, alerts, t],
  );

  const queueDeletion = useCallback(
    (id: string) =>
      explicitStore && store !== null && !invalidatedRef.current
        ? recordDeletion(store, id)
        : undefined,
    [explicitStore, store],
  );

  const queueDismissal = useCallback(
    (id: string, dismissed: boolean) =>
      explicitStore && store !== null && !invalidatedRef.current
        ? recordDismissal(store, id, dismissed)
        : undefined,
    [explicitStore, store],
  );

  const addThing = useCallback(
    async (input: NewThingInput) => {
      if (store === null || ownerMismatch || invalidatedRef.current) return;
      const generation = generationRef.current;
      const now = new Date().toISOString();
      const thing: Thing = {
        id: makeId(),
        name: input.name,
        category: input.category,
        kind: input.kind,
        amount: input.amount ?? null,
        currency: "NGN",
        dueDate: input.dueDate ?? null,
        lastHandledDate: null,
        recurrence: input.recurrence ?? null,
        serviceIntervalDays: input.serviceIntervalDays ?? null,
        status: "active",
        priority: "routine",
        notes: input.notes ?? null,
        details: input.details ?? {},
        createdAt: now,
        updatedAt: now,
      };
      thing.priority = derivePriority(thing);
      if (invalidatedRef.current) return;
      await store.putThing(thing);
      if (invalidatedRef.current) return;
      await hydrate(store, generation);
      return thing;
    },
    [store, hydrate, ownerMismatch],
  );

  /**
   * Records that a responsibility was handled. A recurring thing rolls forward
   * to its next due date; a one-off thing is marked completed.
   */
  const completeThing = useCallback(
    async (thing: Thing) => {
      if (store === null || ownerMismatch || invalidatedRef.current) return;
      const generation = generationRef.current;
      // Local calendar day: toISOString would report UTC's date, which is
      // yesterday just after midnight in Lagos (UTC+1).
      const today = toISO(new Date());
      const updated: Thing = {
        ...thing,
        lastHandledDate: today,
        status: thing.recurrence ? "active" : "completed",
        dueDate: thing.recurrence
          ? nextOccurrence(today, thing.recurrence.frequency, thing.recurrence.interval)
          : thing.dueDate,
        updatedAt: new Date().toISOString(),
      };
      updated.priority = derivePriority(updated);
      if (invalidatedRef.current) return;
      await store.putThing(updated);
      if (invalidatedRef.current) return;
      await hydrate(store, generation);
    },
    [store, hydrate, ownerMismatch],
  );

  const dismissAlert = useCallback(async (alert: Alert) => {
    if (store === null || ownerMismatch || invalidatedRef.current) return;
    setLocal((previous) => {
      if (previous.scope !== store) return previous;
      const next = new Set(previous.dismissedIds);
      next.add(alert.id);
      return { ...previous, dismissedIds: next };
    });
    if (invalidatedRef.current) return;
    await store.putAlert({ ...alert, dismissed: true });
    await queueDismissal(alert.id, true);
  }, [store, queueDismissal, ownerMismatch]);

  const restoreAlerts = useCallback(async () => {
    if (store === null || ownerMismatch || invalidatedRef.current) return;
    setLocal((previous) =>
      previous.scope === store
        ? { ...previous, dismissedIds: NO_DISMISSED_IDS }
        : previous,
    );
    if (invalidatedRef.current) return;
    const stored = await store.getAllAlerts();
    for (const a of stored) {
      if (invalidatedRef.current) return;
      await store.putAlert({ ...a, dismissed: false });
      await queueDismissal(a.id, false);
    }
  }, [store, queueDismissal, ownerMismatch]);

  const updateThing = useCallback(
    async (thing: Thing, patch: Partial<Thing>) => {
      if (store === null || ownerMismatch || invalidatedRef.current) return;
      const generation = generationRef.current;
      const updated: Thing = {
        ...thing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      updated.priority = derivePriority(updated);
      if (invalidatedRef.current) return;
      await store.putThing(updated);
      if (invalidatedRef.current) return;
      await hydrate(store, generation);
      return updated;
    },
    [store, hydrate, ownerMismatch],
  );

  const removeThing = useCallback(
    async (id: string) => {
      if (store === null || ownerMismatch || invalidatedRef.current) return;
      const generation = generationRef.current;
      if (invalidatedRef.current) return;
      await store.deleteThing(id);
      await queueDeletion(id);
      if (invalidatedRef.current) return;
      await hydrate(store, generation);
    },
    [store, queueDeletion, hydrate, ownerMismatch],
  );

  /**
   * Applies a previewed import plan (see lib/import.ts). The plan is only ever
   * produced by parseImport after the user has seen the preview, so this
   * trusts its sanitisation but nothing else: settings land only when the user
   * explicitly opted in at the preview.
   */
  const importThings = useCallback(
    async (plan: ImportPlan, includeSettings: boolean) => {
      if (store === null || ownerMismatch || invalidatedRef.current) return;
      const generation = generationRef.current;
      for (const thing of [...plan.add, ...plan.replace]) {
        if (invalidatedRef.current) return;
        await store.putThing(thing);
      }
      if (includeSettings && plan.settings) {
        if (invalidatedRef.current) return;
        await updateSettings(plan.settings);
      }
      if (invalidatedRef.current) return;
      await hydrate(store, generation);
    },
    [store, hydrate, updateSettings, ownerMismatch],
  );

  const byCategory = useCallback(
    (category: Category) => things.filter((t) => t.category === category),
    [things],
  );

  const totals = useMemo(() => {
    const HORIZON = 30;
    const upcoming = things.filter((t) => {
      if (t.status !== "active" || !t.dueDate) return false;
      const d = daysUntil(t.dueDate);
      return d >= 0 && d <= HORIZON;
    });
    return {
      total: upcoming.reduce((sum, t) => sum + amountOrZero(t.amount), 0),
      count: upcoming.length,
      items: upcoming.sort((a, b) =>
        (a.dueDate ?? "").localeCompare(b.dueDate ?? ""),
      ),
    };
  }, [things]);

  /* Stops this hook from starting any further write. It does not close the
     store: teardown owns the order (cancel reminders, then close), and closing
     here first would turn a failed cancellation into a half-torn-down account. */
  const invalidate = useCallback(() => {
    invalidatedRef.current = true;
  }, []);

  // Reset invalidation when a genuinely new (non-null) store is provided, so
  // a newly signed-in account starts with a clean hook. Stays true while the
  // store is null (signed-out), so stale operations from a previous account
  // remain rejected.
  useEffect(() => {
    if (store !== null) {
      invalidatedRef.current = false;
    }
  }, [store]);

  return {
    loading,
    ready,
    error,
    things,
    alerts,
    status,
    totals,
    settings,
    t,
    refresh,
    updateSettings,
    completeOnboarding,
    loadSampleData,
    deleteEverything,
    addThing,
    completeThing,
    dismissAlert,
    restoreAlerts,
    updateThing,
    removeThing,
    importThings,
    byCategory,
    formatNaira,
    invalidate,
  };
}
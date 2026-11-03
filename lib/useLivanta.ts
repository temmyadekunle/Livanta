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
 * The local-data hook. Without an argument it targets the anonymous `lifedesk`
 * database exactly as before. An explicit store is used for every read and
 * write and is never replaced by the anonymous database.
 *
 * Operations capture the store they started with, so a scope change cannot
 * redirect an in-flight write. A generation token prevents any late completion
 * from publishing data for the previous store into the current UI.
 */
export function useLivanta(...args: [] | [store: LocalStore]) {
  const store = args.length === 0 ? anonymousStore : args[0];
  const explicitStore = args.length === 1;

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

  // State belongs to the store that loaded it. Rendering for a different store
  // immediately hides the old scope instead of waiting for the effect to reset.
  const current = local.scope === store;
  const things = current ? local.things : NO_THINGS;
  const dismissedIds = current ? local.dismissedIds : NO_DISMISSED_IDS;
  const settings = current ? local.settings : DEFAULT_SETTINGS;
  const ready = current && local.ready;
  const loading = current ? local.loading : true;
  const error = current ? local.error : null;

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

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    void hydrate(store, generation, true);
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [store, hydrate]);

  const refresh = useCallback(async () => {
    await hydrate(store, generationRef.current);
  }, [store, hydrate]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const generation = generationRef.current;
    const next = { ...settings, ...patch };
    if (generationRef.current === generation) {
      setLocal((previous) =>
        previous.scope === store ? { ...previous, settings: next } : previous,
      );
    }
    await saveSettings(store, next);
  }, [settings, store]);

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
      await saveSettings(store, next);

      const now = new Date().toISOString();
      for (const first of input.firstThings) {
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

      await loadAndApply(store, generation);
    },
    [settings, store, loadAndApply],
  );

  const loadSampleData = useCallback(async () => {
    const generation = generationRef.current;
    await seedIfEmpty(store);
    await loadAndApply(store, generation);
  }, [store, loadAndApply]);

  const deleteEverything = useCallback(async () => {
    const generation = generationRef.current;
    await store.clear();
    const fresh = { ...DEFAULT_SETTINGS };
    if (generationRef.current === generation) {
      setLocal((previous) =>
        previous.scope === store ? { ...previous, settings: fresh } : previous,
      );
    }
    await saveSettings(store, fresh);
    if (generationRef.current === generation) {
      setLocal((previous) =>
        previous.scope === store
          ? { ...previous, things: NO_THINGS, dismissedIds: NO_DISMISSED_IDS }
          : previous,
      );
    }
  }, [store]);

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
      explicitStore ? recordDeletion(store, id) : recordDeletion(id),
    [explicitStore, store],
  );

  const queueDismissal = useCallback(
    (id: string, dismissed: boolean) =>
      explicitStore
        ? recordDismissal(store, id, dismissed)
        : recordDismissal(id, dismissed),
    [explicitStore, store],
  );

  const addThing = useCallback(
    async (input: NewThingInput) => {
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
      await store.putThing(thing);
      await hydrate(store, generation);
      return thing;
    },
    [store, hydrate],
  );

  /**
   * Records that a responsibility was handled. A recurring thing rolls forward
   * to its next due date; a one-off thing is marked completed.
   */
  const completeThing = useCallback(
    async (thing: Thing) => {
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
      await store.putThing(updated);
      await hydrate(store, generation);
    },
    [store, hydrate],
  );

  const dismissAlert = useCallback(async (alert: Alert) => {
    setLocal((previous) => {
      if (previous.scope !== store) return previous;
      const next = new Set(previous.dismissedIds);
      next.add(alert.id);
      return { ...previous, dismissedIds: next };
    });
    await store.putAlert({ ...alert, dismissed: true });
    await queueDismissal(alert.id, true);
  }, [store, queueDismissal]);

  const restoreAlerts = useCallback(async () => {
    setLocal((previous) =>
      previous.scope === store
        ? { ...previous, dismissedIds: NO_DISMISSED_IDS }
        : previous,
    );
    const stored = await store.getAllAlerts();
    for (const a of stored) {
      await store.putAlert({ ...a, dismissed: false });
      await queueDismissal(a.id, false);
    }
  }, [store, queueDismissal]);

  const updateThing = useCallback(
    async (thing: Thing, patch: Partial<Thing>) => {
      const generation = generationRef.current;
      const updated: Thing = {
        ...thing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      updated.priority = derivePriority(updated);
      await store.putThing(updated);
      await hydrate(store, generation);
      return updated;
    },
    [store, hydrate],
  );

  const removeThing = useCallback(
    async (id: string) => {
      const generation = generationRef.current;
      await store.deleteThing(id);
      await queueDeletion(id);
      await hydrate(store, generation);
    },
    [store, queueDeletion, hydrate],
  );

  /**
   * Applies a previewed import plan (see lib/import.ts). The plan is only ever
   * produced by parseImport after the user has seen the preview, so this
   * trusts its sanitisation but nothing else: settings land only when the user
   * explicitly opted in at the preview.
   */
  const importThings = useCallback(
    async (plan: ImportPlan, includeSettings: boolean) => {
      const generation = generationRef.current;
      for (const thing of [...plan.add, ...plan.replace]) {
        await store.putThing(thing);
      }
      if (includeSettings && plan.settings) {
        await updateSettings(plan.settings);
      }
      await hydrate(store, generation);
    },
    [store, hydrate, updateSettings],
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
  };
}
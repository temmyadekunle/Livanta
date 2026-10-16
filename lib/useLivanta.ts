"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildAlerts, daysUntil, derivePriority, formatNaira } from "./risk.ts";
import { nextOccurrence, toISO } from "./dates.ts";
import type { ImportPlan } from "./import.ts";
import { amountOrZero } from "./money.ts";
import { computeLifeStatus } from "./status.ts";
import { deleteThing, getAllAlerts, getAllThings, putAlert, putThing, clearAllStores } from "./db.ts";
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

export function useLivanta() {
  const [things, setThings] = useState<Thing[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadThings = useCallback(async () => {
    const all = await getAllThings();
    setThings(all);
    const stored = await getAllAlerts();
    setDismissedIds(new Set(stored.filter((a) => a.dismissed).map((a) => a.id)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadSettings();
      setSettings(loaded);
      await loadThings();
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not open the local database.",
      );
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [loadThings]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await loadSettings();
        if (!active) return;
        setSettings(loaded);
        await loadThings();
        if (!active) return;
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(
          e instanceof Error ? e.message : "Could not open the local database.",
        );
      } finally {
        if (!active) return;
        setLoading(false);
        setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadThings]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  }, [settings]);

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
      const next: Settings = {
        ...settings,
        onboarded: true,
        managedCategories: input.categories,
        locale: input.locale ?? settings.locale,
      };
      setSettings(next);
      await saveSettings(next);

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
        await putThing(thing);
      }

      await loadThings();
    },
    [settings, loadThings],
  );

  const loadSampleData = useCallback(async () => {
    await seedIfEmpty();
    await loadThings();
  }, [loadThings]);

  const deleteEverything = useCallback(async () => {
    await clearAllStores();
    const fresh = { ...DEFAULT_SETTINGS };
    setSettings(fresh);
    await saveSettings(fresh);
    setThings([]);
    setDismissedIds(new Set());
  }, []);

  const t = useMemo(() => makeT(settings.locale), [settings.locale]);

  const alerts = useMemo(() => {
    const built = buildAlerts(things, new Date(), t);
    return built.filter((a) => !dismissedIds.has(a.id));
  }, [things, dismissedIds, t]);

  const status = useMemo(
    () => computeLifeStatus(things, alerts, new Date(), t),
    [things, alerts, t],
  );

  const addThing = useCallback(
    async (input: NewThingInput) => {
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
      await putThing(thing);
      await refresh();
      return thing;
    },
    [refresh],
  );

  /**
   * Records that a responsibility was handled. A recurring thing rolls forward
   * to its next due date; a one-off thing is marked completed.
   */
  const completeThing = useCallback(
    async (thing: Thing) => {
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
      await putThing(updated);
      await refresh();
    },
    [refresh],
  );

  const dismissAlert = useCallback(async (alert: Alert) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(alert.id);
      return next;
    });
    await putAlert({ ...alert, dismissed: true });
    await recordDismissal(alert.id, true);
  }, []);

  const restoreAlerts = useCallback(async () => {
    setDismissedIds(new Set());
    const stored = await getAllAlerts();
    for (const a of stored) {
      await putAlert({ ...a, dismissed: false });
      await recordDismissal(a.id, false);
    }
  }, []);

  const updateThing = useCallback(
    async (thing: Thing, patch: Partial<Thing>) => {
      const updated: Thing = {
        ...thing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      updated.priority = derivePriority(updated);
      await putThing(updated);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const removeThing = useCallback(
    async (id: string) => {
      await deleteThing(id);
      await recordDeletion(id);
      await refresh();
    },
    [refresh],
  );

  /**
   * Applies a previewed import plan (see lib/import.ts). The plan is only ever
   * produced by parseImport after the user has seen the preview, so this
   * trusts its sanitisation but nothing else: settings land only when the user
   * explicitly opted in at the preview.
   */
  const importThings = useCallback(
    async (plan: ImportPlan, includeSettings: boolean) => {
      for (const thing of [...plan.add, ...plan.replace]) {
        await putThing(thing);
      }
      if (includeSettings && plan.settings) {
        await updateSettings(plan.settings);
      }
      await refresh();
    },
    [refresh, updateSettings],
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
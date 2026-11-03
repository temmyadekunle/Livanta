/**
 * Drives sync for the app: a cycle on sign-in, a debounced cycle after edits,
 * and one when the tab regains focus.
 *
 * Debouncing matters because editing a thing fires several mutations in quick
 * succession, and syncing on each one would mean a request per keystroke-level
 * change on a metered connection.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { LocalStore } from "./db.ts";
import { runSync, type SyncPhase, type SyncResult } from "./sync/engine.ts";
import { bindSyncOwner, releaseSyncOwner } from "./sync/meta.ts";
import {
  resolveSyncSuspension,
  type SyncSuspensionReason,
} from "./sync/suspension.ts";
import { useAuth } from "./useAuth.ts";

export interface UseCloudSync {
  enabled: boolean;
  signedIn: boolean;
  phase: SyncPhase;
  lastResult: SyncResult | null;
  online: boolean;
  dataSaver: boolean;
  /** True when auth or the account store is not ready, so nothing may sync. */
  suspended?: boolean;
  suspendedReason?: SyncSuspensionReason | null;
  /** Called when a cycle pulled changes down, so the app re-reads local data. */
  bindRefresh: (refresh: () => void) => void;
  /** Queue a sync, coalescing rapid calls. */
  scheduleSync: () => void;
  syncNow: () => Promise<void>;
}

const DEBOUNCE_MS = 2000;

export interface CloudSyncOptions {
  /**
   * The account database currently shown by the app. Sync stays suspended
   * until this exists and belongs to the signed-in account; it never falls
   * back to the anonymous database.
   */
  store?: LocalStore | null;
  /**
   * When the user has asked for low-data mode, background syncing is skipped.
   * The Profile screen promises that data saver keeps sync off, so this has to
   * be honoured or the copy is a lie. An explicit "Sync now" still runs.
   */
  dataSaver?: boolean;
}

export function useCloudSync({
  store = null,
  dataSaver = false,
}: CloudSyncOptions = {}): UseCloudSync {
  const { enabled, status, user } = useAuth();
  const signedIn = status === "signed-in";

  const suspension = resolveSyncSuspension({
    enabled,
    status,
    userId: user?.id ?? null,
    store,
  });
  const suspended = suspension.suspended;
  const suspendedReason = suspension.suspended ? suspension.reason : null;
  const activeOwnerId = suspension.suspended ? null : suspension.owner.userId;

  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [online, setOnline] = useState(
    () => typeof window === "undefined" || window.navigator.onLine,
  );

  // Mutation bookkeeping follows the account store that sync is actually using.
  // A suspended cycle binds nothing, and teardown releases only the owner this
  // effect installed.
  useEffect(() => {
    if (suspended) {
      bindSyncOwner(null);
      return;
    }
    const owner = bindSyncOwner(activeOwnerId);
    return () => releaseSyncOwner(owner);
  }, [suspended, activeOwnerId]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const refreshRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const bindRefresh = useCallback((refresh: () => void) => {
    refreshRef.current = refresh;
  }, []);

  const syncNow = useCallback(async () => {
    if (suspended || !store) return;
    // A cycle already in flight will pick up anything queued behind it, so
    // overlapping cycles are skipped rather than queued.
    if (runningRef.current) return;

    runningRef.current = true;
    setPhase("syncing");
    try {
      const result = await runSync({
        store,
        onChanged: () => refreshRef.current?.(),
      });
      setLastResult(result);
      setPhase("done");
    } catch {
      // Sync failures are never surfaced as blocking errors: the app is fully
      // usable offline, so the next cycle will simply try again.
      setPhase("error");
    } finally {
      runningRef.current = false;
    }
  }, [store, suspended]);

  const scheduleSync = useCallback(() => {
    if (suspended || !store) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void syncNow();
    }, DEBOUNCE_MS);
  }, [store, suspended, syncNow]);

  // First cycle once a session and its account store exist.
  useEffect(() => {
    if (suspended || !store) return;
    void syncNow();
  }, [store, suspended, syncNow]);

  // A queued cycle belongs to the account that queued it. Suspension cancels it
  // before it can open a different database.
  useEffect(() => {
    if (!suspended) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [suspended]);

  // A household app is mostly left open on a phone and on a laptop, so
  // catching up when the tab becomes visible is the sync that matters. It is
  // skipped in low-data mode, where the user has asked Livanta to stay quiet
  // unless they trigger it themselves.
  useEffect(() => {
    if (suspended || !store) return;

    const onVisible = () => {
      if (dataSaver) return;
      if (document.visibilityState === "visible") void syncNow();
    };
    if (!dataSaver) {
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onVisible);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [store, suspended, dataSaver, syncNow]);

  return {
    enabled,
    signedIn,
    phase,
    lastResult,
    online,
    dataSaver,
    suspended,
    suspendedReason,
    bindRefresh,
    scheduleSync,
    syncNow,
  };
}
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { App } from "@capacitor/app";

import { Icon, type IconName } from "./Icons";
import { Avatar } from "./Avatar";
import { ConfirmDialog, Sheet, Toast, useToast } from "./ui";
import { Logo } from "./Logo";
import { QuickAddSheet } from "./QuickAdd";
import { ThingDetailSheet } from "./ThingDetail";
import { AuthScreen, authErrorLabel } from "./AuthScreen";
import Onboarding from "./Onboarding";
import ThingEditor from "./ThingEditor";
import { HomeScreen } from "./screens/HomeScreen";
import { CATEGORY_META, KIND_ICON, MODULE_ICON, MODULES, moduleThings, type ModuleId } from "./maps";
import { TINT_BORDER, TINT_SOFT, tint } from "@/lib/color";
import { dueMeta, TONE_CLASS } from "./labels";
import { formatDate } from "@/lib/dates";
import { formatNaira } from "@/lib/i18n";
import { hasAmount } from "@/lib/money";
import {
  deliverOwnerNotification,
  reconcileReminders,
} from "@/lib/reminders/coordinator";
import { planReminders } from "@/lib/reminders";
import { fromEditorValues, type EditorPreset } from "@/lib/editor";
import InstallPrompt from "./InstallPrompt";
import type { TKey } from "@/lib/locales/en";
import type { Thing } from "@/lib/types";
import {
  isAuthSurface,
  resolveAppSurface,
} from "@/lib/authGate";
import { useAccountStore } from "@/lib/useAccountStore";
import { useAuth } from "@/lib/useAuth";
import { useCloudSync } from "@/lib/useCloudSync";
import { greetingKeyFor, useDayPart } from "@/lib/useDayPart";
import { useLivanta } from "@/lib/useLivanta";
import type { LocalStore } from "@/lib/db.ts";
import {
  subscribeToIdentityChanges,
  type IdentityMessage,
} from "@/lib/identityTransition";
import { readSessionOwner } from "@/lib/sessionAuthority";
import type { AccountTransitionCoordinator } from "@/lib/accountTransition";

type Tab = "home" | "life" | "alerts" | "calendar" | "profile";

type Route =
  | { kind: "module"; id: ModuleId }
  | { kind: "auth" };

/* Everything behind a tap is code-split out of the first paint. The home tab,
   the shell and the sheets stay eager because they are what a first load
   actually shows; the other screens are reached by a deliberate navigation, so
   the network hop to fetch their chunk happens once and is served from the
   service worker cache after that. ssr: false keeps the static export from
   preloading them, which would quietly undo the split. */
const ModuleScreen = dynamic(() => import("./ModuleScreen"), { ssr: false });
const LifeScreen = dynamic(
  () => import("./screens/LifeScreen").then((m) => ({ default: m.LifeScreen })),
  { ssr: false },
);
const AlertsScreen = dynamic(
  () => import("./screens/AlertsScreen").then((m) => ({ default: m.AlertsScreen })),
  { ssr: false },
);
const CalendarScreen = dynamic(
  () => import("./screens/CalendarScreen").then((m) => ({ default: m.CalendarScreen })),
  { ssr: false },
);
const ProfileScreen = dynamic(
  () => import("./screens/ProfileScreen").then((m) => ({ default: m.ProfileScreen })),
  { ssr: false },
);

const TABS: { id: Tab; labelKey: TKey; icon: IconName }[] = [
  { id: "home", labelKey: "tab.home", icon: "home" },
  { id: "life", labelKey: "tab.life", icon: "layers" },
  { id: "alerts", labelKey: "tab.alerts", icon: "bell" },
  { id: "calendar", labelKey: "tab.calendar", icon: "calendar" },
  { id: "profile", labelKey: "tab.profile", icon: "user" },
];

/* Shown while a code-split screen fetches. The shimmer says "this is loading"
   rather than "this is broken", and the sr-only label gives screen readers the
   same information. Sized to a plausible screen so the nav does not jump when
   the real content lands. */
function ScreenFallback({ label }: { label: string }) {
  return (
    <div className="screen-skel" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skel screen-skel__bar" />
      <div className="skel screen-skel__bar" />
      <div className="skel screen-skel__bar" />
    </div>
  );
}

export default function LivantaApp({
  coordinator,
}: {
  /* Owned by AppEntry, which is not remounted with the auth status, so a
     transition survives the remount this component performs. */
  coordinator: AccountTransitionCoordinator;
}) {
  const auth = useAuth();
  const [accountResetToken, setAccountResetToken] = useState(0);
  const account = useAccountStore({
    authEnabled: auth.enabled,
    authStatus: auth.status,
    userId: auth.user?.id ?? null,
    resetToken: accountResetToken,
  });
  const desk = useLivanta(account.store, account.expectedUserId);
  const { t, refresh } = desk;
  const sync = useCloudSync({ dataSaver: desk.settings.dataSaver });
  const { toast, showToast } = useToast();

  const [tab, setTab] = useState<Tab>("home");
  const [stack, setStack] = useState<Route[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPreset, setQuickPreset] = useState<EditorPreset | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmThing, setConfirmThing] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [obStep, setObStep] = useState(0);
  const [obAuthOpen, setObAuthOpen] = useState(false);
  /** Another tab ended this session; this tab must not show the account. */
  const [identityRevoked, setIdentityRevoked] = useState(false);
  /** A local teardown failed; nothing may activate until it succeeds. */
  const [transitionFailure, setTransitionFailure] = useState<string | null>(null);
  /* The failed-link banner resends to an address the user names: the account
     still signed in is not the one whose link failed, so its address is only a
     starting point, never an assumption. */
  const [resendEmail, setResendEmail] = useState(() => auth.pendingEmail ?? "");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendStatus, setResendStatus] = useState<{
    tone: "ok" | "danger";
    text: string;
  } | null>(null);

  /* One pure decision owns which surface may render. In particular it has no
     dismissal input and does not consult local storage, so neither an earlier
     dismissal nor browser navigation can weaken it. */
  const surface = resolveAppSurface({
    ready: desk.ready,
    onboarded: desk.settings.onboarded,
    authEnabled: auth.enabled,
    authStatus: auth.status,
    passwordResetReady: auth.passwordResetReady,
    identityInvalid: account.status === "error",
    teardownPending: auth.teardownPending,
    identityRevoked,
  });
  const authSurface = isAuthSurface(surface);

  const push = useCallback((route: Route) => setStack((s) => [...s, route]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  async function resendFromBanner(event: React.FormEvent) {
    event.preventDefault();
    if (!resendEmail.trim() || resendBusy) return;
    setResendBusy(true);
    setResendStatus(null);
    const outcome = await auth.resendConfirmation(resendEmail);
    setResendBusy(false);
    // Only a request Supabase accepted may be described as on its way.
    setResendStatus(
      outcome.ok
        ? { tone: "ok", text: t("auth.resendSent") }
        : { tone: "danger", text: authErrorLabel(t, outcome.error.code) },
    );
  }

  useEffect(() => {
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void App.addListener("backButton", () => {
      // Compulsory authentication has no hardware escape: back does nothing on
      // any surface whose only job is to establish or repair a session.
      if (authSurface || transitionFailure) return;
      if (confirmWipe || confirmThing !== null) {
        setConfirmWipe(false);
        setConfirmThing(null);
      } else if (obAuthOpen) {
        setObAuthOpen(false);
      } else if (!desk.settings.onboarded && obStep > 0) {
        setObStep(obStep - 1);
      } else if (quickOpen) {
        setQuickOpen(false);
      } else if (openId !== null) {
        setOpenId(null);
      } else if (editId !== null) {
        setEditId(null);
      } else if (stack.length > 0) {
        pop();
      } else if (tab !== "home") {
        setStack([]);
        setTab("home");
      } else {
        void App.exitApp();
      }
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [confirmWipe, confirmThing, obAuthOpen, authSurface, transitionFailure, obStep, desk.settings.onboarded, quickOpen, openId, editId, stack, tab, pop]);

  // A completed sync writes to IndexedDB, so the desk has to re-read for the
  // pulled state to appear.
  useEffect(() => {
    sync.bindRefresh(() => void refresh());
  }, [sync, refresh]);

  /* Queue a sync whenever local data actually changed. `scheduleSync` is a
     no-op unless the build has Supabase credentials and a session exists, so
     this is inert for the signed-out app that ships by default. */
  const signature = useMemo(
    () =>
      `${desk.things.length}:${desk.things
        .map((x) => `${x.updatedAt}${x.status}`)
        .join("|")}:${desk.alerts.length}`,
    [desk.things, desk.alerts.length],
  );
  const scheduleSync = sync.scheduleSync;
  useEffect(() => {
    if (!desk.ready) return;
    scheduleSync();
  }, [signature, desk.ready, scheduleSync]);

  /* Minute tick: the in-session fallback needs to notice time passing while
     the tab stays open (a 9am reminder must fire at 9am, not at the next data
     change). 60s granularity matches the planner's day/hour resolution. */
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  /* Hand the reminder plan to the native scheduler (AlarmManager via the
     local notifications plugin), which fires with the app closed. On the web
     this resolves to "unsupported" immediately — there is no reliable
     scheduled-notification API there — and the in-session path below is the
     only delivery. Every call goes through the reminder coordinator, which
     refuses a plan whose owner is not the current session owner or does not
     match the persisted marker, and reconciles wholesale under the identity
     lock. The signature gate keeps data changes from turning into a
     cancel/reschedule loop. */
  const lastScheduled = useRef("");
  const notified = useRef<Set<string>>(new Set());

  /* A different store means a different account (or a fresh store for the same
     one). Both the schedule signature and the in-session notification memory
     describe the previous store, so they must not be carried over: a matching
     signature would otherwise skip re-scheduling reminders that teardown had
     cancelled, and a remembered alert id would suppress it for the new owner. */
  const scheduledStoreRef = useRef<LocalStore | null>(null);
  useEffect(() => {
    if (scheduledStoreRef.current === account.store) return;
    scheduledStoreRef.current = account.store;
    lastScheduled.current = "";
    notified.current = new Set();
  }, [account.store]);

  useEffect(() => {
    if (!desk.ready) return;
    const plan = desk.settings.notifyUrgent
      ? planReminders(desk.things, {
          leadDays: desk.settings.leadDays,
          tr: t,
        })
      : [];
    // Locale in the signature: switching language must re-schedule so the
    // native notifications carry copy in the new language.
    const signature = `${t.locale}|${plan
      .map((r) => `${r.id}@${r.fireAt.getTime()}`)
      .join("|")}`;
    if (signature === lastScheduled.current) return;
    lastScheduled.current = signature;
    void reconcileReminders({
      authEnabled: auth.enabled,
      ownerId: account.expectedUserId,
      plan,
    });
  }, [
    desk.ready,
    desk.things,
    desk.settings.notifyUrgent,
    desk.settings.leadDays,
    t,
    auth.enabled,
    account.expectedUserId,
  ]);

  useEffect(() => {
    if (!desk.ready || !desk.settings.notifyUrgent) return;
    const authEnabled = auth.enabled;
    const ownerId = account.expectedUserId;
    void (async () => {
      const urgent = desk.alerts.find((a) => a.priority === "urgent");
      if (
        urgent &&
        (await deliverOwnerNotification({
          authEnabled,
          ownerId,
          notification: {
            id: urgent.id,
            title: urgent.title,
            body: urgent.message,
          },
          alreadyNotified: notified.current,
        }))
      ) {
        notified.current.add(urgent.id);
      }

      const now = new Date();
      const plan = planReminders(desk.things, {
        leadDays: desk.settings.leadDays,
        tr: t,
        now,
      });
      for (const reminder of plan) {
        if (reminder.fireAt.getTime() > now.getTime()) continue;
        if (
          await deliverOwnerNotification({
            authEnabled,
            ownerId,
            notification: reminder,
            alreadyNotified: notified.current,
          })
        ) {
          notified.current.add(reminder.id);
        }
      }
    })();
  }, [
    desk.ready,
    desk.settings.notifyUrgent,
    desk.settings.leadDays,
    desk.alerts,
    desk.things,
    t,
    nowTick,
    auth.enabled,
    account.expectedUserId,
  ]);

  const openThing = useCallback((thing: Thing) => {
    setEditId(null);
    setOpenId(thing.id);
  }, []);

  const startAdd = useCallback((preset?: EditorPreset) => {
    setQuickPreset(preset ?? null);
    setQuickOpen(true);
  }, []);

  const closeSheets = useCallback(() => {
    setQuickOpen(false);
    setQuickPreset(null);
    setOpenId(null);
    setEditId(null);
  }, []);

  /* Every account transition goes through one coordinator. It records the
     current session, and tears that session down exactly once no matter how
     many signals (sign-out callback, auth-status edge, another tab) ask for it.
     A failed attempt may be retried and never suppresses a later session. */
  const lastReasonRef = useRef<IdentityMessage["reason"]>("sign-out");

  useEffect(() => {
    if (auth.status === "signed-in" && account.expectedUserId && account.store) {
      coordinator.signedIn(account.expectedUserId, account.store);
    }
  }, [auth.status, account.expectedUserId, account.store, coordinator]);

  /* Leaves no dialog, sheet, editor or onboarding step from the previous
     account on screen. Persistent records are untouched; this is view state. */
  const resetUi = useCallback(() => {
    setTab("home");
    setStack([]);
    setQuickOpen(false);
    setQuickPreset(null);
    setOpenId(null);
    setEditId(null);
    setBusy(false);
    setConfirmThing(null);
    setConfirmWipe(false);
    setObStep(0);
    setObAuthOpen(false);
  }, []);

  /* Signs out of cloud authentication and tears down the local account state
     (reminders, store, sync binding) before the gate can activate another
     account. If teardown fails, useAuth keeps the app fail-closed. */
  const invalidateDesk = desk.invalidate;
  const handleSignOut = useCallback(async () => {
    await auth.signOut(() => {
      invalidateDesk();
      return coordinator.signOut("sign-out");
    });
  }, [auth, coordinator, invalidateDesk]);

  /* A sign-out that did not go through handleSignOut — a Supabase-initiated
     session expiry — is owned by useAuth's registered teardown. This edge is a
     fallback for the live instance: it clears view state and, only if the
     coordinator still owns the account that just ended, asks it to tear down.
     Checking the recorded owner matters because the next account can register
     before a delayed effect runs; tearing that account down as if it were the
     previous one would be worse than doing nothing here. The coordinator turns
     a duplicate request into the same operation. */
  const prevAuthRef = useRef({
    status: auth.status,
    userId: auth.user?.id ?? null,
  });
  useEffect(() => {
    const prev = prevAuthRef.current;
    prevAuthRef.current = {
      status: auth.status,
      userId: auth.user?.id ?? null,
    };
    if (prev.status !== "signed-in" || auth.status !== "signed-out") return;
    resetUi();
    invalidateDesk();
    if (prev.userId === null || coordinator.currentUserId() !== prev.userId) {
      return;
    }
    void coordinator.signOut("sign-out").then((result) => {
      if (!result.ok) setTransitionFailure(result.reason);
    });
  }, [auth.status, auth.user?.id, coordinator, resetUi, invalidateDesk]);

  /* Another tab signed out or switched. The signal carries no identity, so it
     is never authority: hide this tab's records synchronously (the surface
     change happens before the first await), then read the session that is
     actually current. If it still names the account this tab displays, the
     signal did not change this tab's owner and the view is restored without a
     teardown. Otherwise the outgoing account is torn down and only then
     reconciled with Supabase. A teardown failure stays blocked rather than
     revealing the account again. */
  const handleRemoteTransition = useCallback(
    async (message: IdentityMessage) => {
      const current = coordinator.currentUserId();
      if (current === null) return;

      setIdentityRevoked(true);

      let next: string | null = null;
      try {
        next = await readSessionOwner();
      } catch {
        // An unreadable authority cannot prove this tab is still current;
        // continue with teardown so nothing stale remains active.
        next = null;
      }

      if (next !== null && next === current) {
        setIdentityRevoked(false);
        return;
      }

      lastReasonRef.current = message.reason;
      resetUi();
      invalidateDesk();
      const result = await coordinator.signOut(message.reason, {
        broadcast: false,
      });
      if (!result.ok) {
        setTransitionFailure(result.reason);
        return;
      }
      setTransitionFailure(null);
      setAccountResetToken((token) => token + 1);
      await auth.retrySession();
      setIdentityRevoked(false);
    },
    [auth, coordinator, resetUi, invalidateDesk],
  );

  useEffect(
    () =>
      subscribeToIdentityChanges((message) => {
        void handleRemoteTransition(message);
      }),
    [handleRemoteTransition],
  );

  /* Retries whichever local teardown failed. Account activation stays blocked
     until it succeeds, so recovery can never expose the old account or let a
     new one start over the old reminders. */
  const retryLocalTransition = useCallback(async () => {
    setTransitionFailure(null);
    invalidateDesk();
    const result = await coordinator.signOut(lastReasonRef.current, {
      broadcast: false,
    });
    if (!result.ok) {
      setTransitionFailure(result.reason);
      return;
    }
    if (identityRevoked) {
      setAccountResetToken((token) => token + 1);
      await auth.retrySession();
      setIdentityRevoked(false);
    }
  }, [auth, coordinator, identityRevoked, invalidateDesk]);

  /* A local teardown failed, so the previous account's reminders or store may
     still be active. Nothing else may open until it succeeds — including the
     sign-in form — so this is a blocking surface with a single way forward. */
  if (transitionFailure) {
    return (
      <div className="app" lang={desk.settings.locale}>
        <div className="app__col">
          <div className="app__body">
            <div className="ob-brand" style={{ textAlign: "center" }}>
              <Logo variant="wordmark" priority />
              <h2 className="ob-h" style={{ marginTop: "1rem", marginBottom: "0.25rem" }}>
                {t("auth.teardownTitle")}
              </h2>
              <p className="card-meta">{t("auth.teardownBody")}</p>
              <p className="card-meta" role="alert">
                {transitionFailure}
              </p>
            </div>
            <button
              className="btn btn--primary btn--lg btn--block"
              style={{ marginTop: "1.5rem" }}
              onClick={() => void retryLocalTransition()}
            >
              <Icon name="refresh" size={18} />
              {t("app.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* Scope error: the store belongs to a different account. No account records
     are exposed. The user can retry to re-hydrate, or sign out and sign in
     again to resolve the mismatch. */
  if (desk.error && !desk.ready && !desk.loading) {
    return (
      <div className="app" lang={desk.settings.locale}>
        <div className="app__col">
          <div className="app__body">
            <div className="ob-brand" style={{ textAlign: "center" }}>
              <Logo variant="wordmark" priority />
              <h2 className="ob-h" style={{ marginTop: "1rem", marginBottom: "0.25rem" }}>
                {t("auth.sessionErrorTitle")}
              </h2>
              <p className="card-meta">{desk.error}</p>
            </div>
            <button
              className="btn btn--primary btn--lg btn--block"
              style={{ marginTop: "1.5rem" }}
              onClick={() => void refresh()}
            >
              <Icon name="refresh" size={18} />
              {t("app.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  async function saveNew(values: ReturnType<typeof fromEditorValues>) {
    setBusy(true);
    try {
      const thing = await desk.addThing(values);
      if (!thing) return;
      closeSheets();
      showToast(t("thing.savedToast", { name: thing.name }), "ok");
    } catch {
      showToast(t("auth.unknown"), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(values: ReturnType<typeof fromEditorValues>) {
    const target = desk.things.find((x) => x.id === editId);
    if (!target) return;
    setBusy(true);
    try {
      await desk.updateThing(target, values);
      setEditId(null);
      showToast(t("thing.savedToast", { name: values.name }), "ok");
    } catch {
      showToast(t("auth.unknown"), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleThing(thing: Thing) {
    setBusy(true);
    await desk.completeThing(thing);
    setBusy(false);
    setOpenId(null);
    showToast(t("thing.handledToast"), "ok");
  }

  /* -------------------------------------------------------------- gates */

  if (surface.kind === "onboarding" || surface.kind === "setup") {
    return (
      <div className="app" lang={desk.settings.locale}>
        <div className="app__col">
          <div
            className="app__body"
            style={obAuthOpen ? { display: "none" } : undefined}
          >
            <Onboarding
              locale={desk.settings.locale}
              step={obStep}
              onStepChange={setObStep}
              onDone={(result) => void desk.completeOnboarding(result)}
              onSignIn={() => setObAuthOpen(true)}
            />
          </div>
          {obAuthOpen ? (
            <>
              <header className="appbar">
                <div className="appbar__lead">
                  <button
                    className="iconbtn"
                    onClick={() => setObAuthOpen(false)}
                    aria-label={t("app.back")}
                  >
                    <Icon name="chevronLeft" size={22} />
                  </button>
                  <div style={{ minWidth: 0 }}>
                    <h1 className="appbar__title">{t("account.title")}</h1>
                    <p className="appbar__sub">{t("account.subtitle")}</p>
                  </div>
                </div>
              </header>
              <div className="app__body">
                <AuthScreen
                  t={t}
                  auth={auth}
                  onClose={() => setObAuthOpen(false)}
                  onDone={(message) => {
                    showToast(message, "ok");
                    setObAuthOpen(false);
                    void desk.completeOnboarding({
                      categories: [],
                      firstThings: [],
                      locale: desk.settings.locale,
                    });
                  }}
                  onSignOut={handleSignOut}
                />
              </div>
            </>
          ) : null}
        </div>
        <Toast toast={toast} />
      </div>
    );
  }

  if (surface.kind === "auth-loading") {
    return (
      <div className="app" lang={desk.settings.locale}>
        <div className="app__col">
          <div className="app__body splash" role="status" aria-live="polite">
            <span className="splash__logo">
              <Logo variant="wordmark" priority />
            </span>
            <p className="splash__slogan">{t("auth.checking")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (surface.kind === "auth-error") {
    return (
      <div className="app" lang={desk.settings.locale}>
        <div className="app__col">
          <div className="app__body">
            <div className="ob-brand" style={{ textAlign: "center" }}>
              <Logo variant="wordmark" priority />
              <h2 className="ob-h" style={{ marginTop: "1rem", marginBottom: "0.25rem" }}>
                {t("auth.sessionErrorTitle")}
              </h2>
              <p className="card-meta">{t("auth.sessionErrorBody")}</p>
              {auth.error?.code === "unsupported-browser" ? (
                <p className="card-meta" role="alert">
                  {auth.error.message}
                </p>
              ) : null}
            </div>
            <button
              className="btn btn--primary btn--lg btn--block"
              style={{ marginTop: "1.5rem" }}
              onClick={() => void auth.retrySession()}
            >
              <Icon name="refresh" size={18} />
              {t("app.retry")}
            </button>
            {/* A signed-in session whose account id is unusable cannot be
                repaired by re-reading it; signing out is the way back to a
                usable gate. A failed session read has no account to leave. */}
            {auth.status === "signed-in" ? (
              <button
                className="btn btn--soft btn--lg btn--block"
                style={{ marginTop: "0.75rem" }}
                onClick={() => void handleSignOut()}
              >
                {t("account.signOut")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  /* The remote session is gone but this device could not finish clearing the
     previous account. No account may open until the retry succeeds. */
  if (surface.kind === "identity-recovery") {
    return (
      <div className="app" lang={desk.settings.locale}>
        <div className="app__col">
          <div className="app__body">
            <div className="ob-brand" style={{ textAlign: "center" }}>
              <Logo variant="wordmark" priority />
              <h2 className="ob-h" style={{ marginTop: "1rem", marginBottom: "0.25rem" }}>
                {t("auth.teardownTitle")}
              </h2>
              <p className="card-meta">{t("auth.teardownBody")}</p>
            </div>
            <button
              className="btn btn--primary btn--lg btn--block"
              style={{ marginTop: "1.5rem" }}
              onClick={() => void auth.retryTransition()}
            >
              <Icon name="refresh" size={18} />
              {t("app.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (surface.kind === "auth-gate" || surface.kind === "recovery") {
    return (
      <div className="app" lang={desk.settings.locale}>
        <div className="app__col">
          {/* No back control: the gate is the only way forward, and a recovery
              link owns the session until the new password is set. */}
          <header className="appbar">
            <div className="appbar__lead">
              <span className="appbar__logo">
                <Logo />
              </span>
              <div style={{ minWidth: 0 }}>
                <h1 className="appbar__title">{t("account.title")}</h1>
                <p className="appbar__sub">{t("account.subtitle")}</p>
              </div>
            </div>
          </header>
          <main className="app__body" id="app-main" tabIndex={-1}>
            <AuthScreen
              t={t}
              auth={auth}
              initialMode={surface.kind === "recovery" ? "sign-in" : "welcome"}
              onDone={(message) => showToast(message, "ok")}
              onSignOut={handleSignOut}
            />
          </main>
        </div>
        <Toast toast={toast} />
      </div>
    );
  }

  if (surface.kind === "booting") {
    return (
      <div className="app" lang={desk.settings.locale}>
        <div className="app__col">
          <div className="app__body splash" role="status" aria-live="polite">
            <span className="splash__logo">
              <Logo variant="wordmark" priority />
            </span>
            <p className="splash__slogan">{t("app.slogan")}</p>
            <span className="sr-only">{t("app.loading")}</span>
          </div>
        </div>
      </div>
    );
  }

  const route: Route | null = stack[stack.length - 1] ?? null;
  const open = openId ? desk.things.find((x) => x.id === openId) ?? null : null;
  const editing = editId ? desk.things.find((x) => x.id === editId) ?? null : null;

  return (
    <div className="app" lang={desk.settings.locale}>
      <div className="app__col">
        <a className="skiplink" href="#app-main">
          {t("ui.skipToContent")}
        </a>
        <Header
          desk={desk}
          tab={tab}
          route={route}
          onBack={pop}
          onOpenAlerts={() => {
            setStack([]);
            setTab("alerts");
          }}
          onOpenProfile={() => {
            setStack([]);
            setTab("profile");
          }}
        />

        <main className="app__body" id="app-main" tabIndex={-1}>
          {auth.confirmationError ? (
            <div style={{ marginBottom: "0.875rem" }}>
              <div className="notice notice--danger" role="alert">
                <Icon name="alert" size={18} className="notice__icon" />
                <div className="notice__body">
                  <strong>{t("auth.confirmLinkTitle")}</strong>
                  <br />
                  {t("auth.confirmLinkStillSignedIn", {
                    email: auth.user?.email ?? "",
                  })}
                  <div
                    style={{
                      marginTop: "0.625rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                      alignItems: "flex-start",
                    }}
                  >
                    {resendStatus ? (
                      <p
                        role="status"
                        style={{
                          color:
                            resendStatus.tone === "danger"
                              ? "var(--danger)"
                              : "var(--ok)",
                        }}
                      >
                        {resendStatus.text}
                      </p>
                    ) : null}
                    <form
                      onSubmit={resendFromBanner}
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                        alignItems: "center",
                        width: "100%",
                      }}
                    >
                      <input
                        id="resend-email"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        aria-label={t("account.email")}
                        placeholder="name@example.com"
                        value={resendEmail}
                        onChange={(event) => setResendEmail(event.target.value)}
                        style={{ flex: "1 1 12rem", minWidth: 0 }}
                      />
                      <button
                        type="submit"
                        className="btn btn--soft btn--sm"
                        disabled={resendBusy || !resendEmail.trim()}
                      >
                        {resendBusy
                          ? t("auth.working")
                          : t("auth.resendConfirmation")}
                      </button>
                    </form>
                    <button
                      className="btn btn--soft btn--sm"
                      onClick={() => auth.clearConfirmationError()}
                    >
                      {t("app.dismiss")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {desk.error ? (
            <div style={{ marginBottom: "0.875rem" }}>
              <div className="notice notice--danger">
                <Icon name="alert" size={18} className="notice__icon" />
                <div className="notice__body">
                  <strong>{t("app.error.title")}</strong>
                  <br />
                  {desk.error}
                  <div style={{ marginTop: "0.625rem" }}>
                    <button
                      className="btn btn--soft btn--sm"
                      onClick={() => void refresh()}
                    >
                      <Icon name="refresh" size={16} />
                      {t("app.retry")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {route?.kind === "module" ? (
            <ModuleHeader
              id={route.id}
              t={t}
              count={moduleThings(desk.things, route.id).length}
            />
          ) : null}

          <Suspense fallback={<ScreenFallback label={t("app.loading")} />}>
            {route?.kind === "module" ? (
              <ModuleScreen
                module={route.id}
                things={desk.things}
                t={t}
                onOpenThing={(thing) => {
                  setStack([]);
                  openThing(thing);
                }}
              />
            ) : route?.kind === "auth" ? (
              <AuthScreen
                t={t}
                auth={auth}
                onClose={pop}
                onDone={(message) => showToast(message, "ok")}
                onSignOut={handleSignOut}
              />
            ) : tab === "home" ? (
              <HomeScreen
                desk={desk}
                onOpenThing={openThing}
                onAdd={startAdd}
                onAddMore={() => startAdd()}
                onOpenModule={(id) => push({ kind: "module", id })}
                onOpenAlerts={() => {
                  setStack([]);
                  setTab("alerts");
                }}
                onOpenCalendar={() => {
                  setStack([]);
                  setTab("calendar");
                }}
                onOpenLife={() => {
                  setStack([]);
                  setTab("life");
                }}
              />
            ) : tab === "life" ? (
              <LifeScreen
                desk={desk}
                onOpenModule={(id) => push({ kind: "module", id })}
                onOpenThing={openThing}
                onAddProvider={() =>
                  startAdd({ label: t("kind.service-provider"), kind: "service-provider", category: "services" })
                }
                onAdd={() => startAdd()}
              />
            ) : tab === "alerts" ? (
              <AlertsScreen
                desk={desk}
                onOpenThing={openThing}
                onAdd={() => startAdd()}
              />
            ) : tab === "calendar" ? (
              <CalendarScreen desk={desk} onOpenThing={openThing} onAdd={() => startAdd()} />
            ) : (
              <ProfileScreen
                desk={desk}
                auth={auth}
                sync={sync}
                onOpenAuth={() => push({ kind: "auth" })}
                onOpenConfirmDeleteAll={() => setConfirmWipe(true)}
                onSignOut={handleSignOut}
                showToast={showToast}
              />
            )}
          </Suspense>
        </main>

        <nav className="bottomnav" aria-label={t("nav.primary")}>
          {TABS.map((def) => (
            <button
              key={def.id}
              type="button"
              className={
                def.id === tab && !route ? "navitem navitem--on" : "navitem"
              }
              onClick={() => {
                setStack([]);
                setTab(def.id);
              }}
              aria-current={def.id === tab && !route ? "page" : undefined}
            >
              <span className="navitem__icon">
                <Icon name={def.icon} size={21} />
              </span>
              <span className="navitem__label">{t(def.labelKey)}</span>
            </button>
          ))}
        </nav>

        <InstallPrompt />

        <button
          type="button"
          className="fab"
          onClick={() => startAdd()}
          aria-label={t("qa.title")}
        >
          <Icon name="plus" size={26} strokeWidth={2.1} />
        </button>
      </div>

      <DesktopRail desk={desk} onOpenThing={openThing} />

      {/* ---------------------------------------------------------- sheets */}

      <Toast toast={toast} />

      {quickOpen ? (
        <QuickAddSheet
          t={t}
          busy={busy}
          initial={quickPreset ?? undefined}
          initialCategory={quickPreset?.category}
          onClose={closeSheets}
          onSave={(values) => void saveNew(values)}
        />
      ) : null}

      {editing ? (
        <QuickAddEditHost
          thing={editing}
          t={t}
          busy={busy}
          onCancel={() => setEditId(null)}
          onSave={(values) => void saveEdit(values)}
        />
      ) : null}

      {open && !editing ? (
        <ThingDetailSheet
          thing={open}
          t={t}
          leadDays={desk.settings.leadDays}
          busy={busy}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditId(open.id)}
          onDelete={() => setConfirmThing(open.id)}
          onHandle={() => void handleThing(open)}
        />
      ) : null}

      {confirmThing ? (
        <ConfirmDialog
          title={t("thing.deleteTitle")}
          message={t("thing.deleteBody", {
            name: desk.things.find((x) => x.id === confirmThing)?.name ?? "",
          })}
          confirmLabel={t("things.delete")}
          cancelLabel={t("ed.cancel")}
          destructive
          onCancel={() => setConfirmThing(null)}
          onConfirm={() => {
            const target = desk.things.find((x) => x.id === confirmThing);
            setConfirmThing(null);
            setOpenId(null);
            if (!target) return;
            void desk.removeThing(target.id);
            showToast(t("thing.deletedToast"), "info");
          }}
        />
      ) : null}

      {confirmWipe ? (
        <ConfirmDialog
          title={t("profile.deleteAll")}
          message={t("profile.confirmDeleteAll")}
          confirmLabel={t("profile.deleteAll")}
          cancelLabel={t("ed.cancel")}
          destructive
          onCancel={() => setConfirmWipe(false)}
          onConfirm={() => {
            setConfirmWipe(false);
            void desk.deleteEverything();
            showToast(t("thing.deletedToast"), "info");
            window.location.reload();
          }}
        />
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- header */

function Header({
  desk,
  tab,
  route,
  onBack,
  onOpenAlerts,
  onOpenProfile,
}: {
  desk: ReturnType<typeof useLivanta>;
  tab: Tab;
  route: Route | null;
  onBack: () => void;
  onOpenAlerts: () => void;
  onOpenProfile: () => void;
}) {
  const { t } = desk;
  const name = desk.settings.displayName;

  let title: string;
  let sub: string | undefined;

  if (route?.kind === "module") {
    const mod = MODULES.find((m) => m.id === route.id);
    title = mod ? t(mod.labelKey) : "";
    sub = t("ui.lifeArea");
  } else if (route?.kind === "auth") {
    title = t("account.title");
    sub = t("account.subtitle");
  } else if (tab === "home") {
    title = t("app.brand");
    sub = formatDate(new Date(), t.locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } else if (tab === "life") {
    title = t("life.title");
    sub = t("life.subtitle");
  } else if (tab === "alerts") {
    title = t("alerts.title");
    sub =
      desk.alerts.length > 0
        ? t.n("alerts.count", desk.alerts.length, { status: desk.status.label })
        : t("alerts.emptyTitle");
  } else if (tab === "calendar") {
    title = t("tab.calendar");
    sub = t("cal.subtitle");
  } else {
    title = t("tab.profile");
    sub = name;
  }

  return (
    <header className="appbar">
<div className="appbar__lead">
        {route ? (
          <button className="iconbtn" onClick={onBack} aria-label={t("app.back")}>
            <Icon name="chevronLeft" size={22} />
          </button>
        ) : (
          // The mark only appears at a tab root. On a pushed route the back
          // chevron already occupies the leading slot, and a 32px logo beside
          // it plus a title plus two actions does not fit a 360px screen.
          <span className="appbar__logo">
            <Logo />
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 className="appbar__title">{title}</h1>
          {sub ? <p className="appbar__sub">{sub}</p> : null}
        </div>
      </div>
      <div className="appbar__actions">
        <button
          className="iconbtn"
          onClick={onOpenAlerts}
          aria-label={t("alerts.title")}
        >
          <Icon name="bell" size={21} />
          {desk.alerts.length > 0 ? (
            <span className="iconbtn__dot">{desk.alerts.length > 9 ? "9+" : desk.alerts.length}</span>
          ) : null}
        </button>
        <button
          className="iconbtn"
          onClick={onOpenProfile}
          aria-label={t("tab.profile")}
        >
          <Avatar name={name || t("app.brand")} src={desk.settings.avatar} />
        </button>
      </div>
    </header>
  );
}

function ModuleHeader({
  id,
  t,
  count,
}: {
  id: ModuleId;
  t: ReturnType<typeof useLivanta>["t"];
  count: number;
}) {
  const mod = MODULES.find((m) => m.id === id);
  if (!mod) return null;
  return (
    <section className="section" style={{ marginTop: "0.875rem" }}>
      <div className="card card--quiet">
        <div className="rowline">
          <span
            className="module-ico"
            style={{ color: mod.color, background: tint(mod.color, TINT_SOFT), marginBottom: 0, flex: "none" }}
          >
            <Icon name={MODULE_ICON[id]} size={20} />
          </span>
          <div className="listrow__body">
            <p className="module-label" style={{ margin: 0 }}>
              {t(mod.labelKey)}
            </p>
            <p className="module-blurb">{t(mod.blurbKey)}</p>
          </div>
        </div>
        <p className="card-meta" style={{ marginTop: "0.5rem" }}>
          {t.n("svc.items", count)}
        </p>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- desktop rail */

function DesktopRail({
  desk,
  onOpenThing,
}: {
  desk: ReturnType<typeof useLivanta>;
  onOpenThing: (thing: Thing) => void;
}) {
    const { t } = desk;
    const part = useDayPart();
    const soon = desk.things
    .filter((x) => x.status === "active" && x.dueDate)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 6);

  return (
    <aside className="app__aside">
      <div className="railhead">
        <Avatar name={desk.settings.displayName || t("app.brand")} src={desk.settings.avatar} large />
        <div>
          <p className="railhead__title">{t("app.tagline")}</p>
          <p className="railhead__sub">
            {t(greetingKeyFor(part, desk.settings.displayName), {
              name: desk.settings.displayName,
            })}
          </p>
        </div>
      </div>

      <p className="railtitle">{t("home.needsAttention")}</p>
      <div className="statgrid" style={{ marginBottom: "1.75rem" }}>
        <div className="stat">
          <div className="stat-num urgent">{desk.status.urgentCount}</div>
          <div className="stat-label">{t("home.stat.urgent")}</div>
        </div>
        <div className="stat">
          <div className="stat-num important">{desk.status.importantCount}</div>
          <div className="stat-label">{t("home.stat.important")}</div>
        </div>
        <div className="stat">
          <div className="stat-num routine">{desk.status.onTrackCount}</div>
          <div className="stat-label">{t("home.stat.onTrack")}</div>
        </div>
      </div>

      {soon.length > 0 ? (
        <>
          <p className="railtitle">{t("home.comingSoon")}</p>
          <div className="list" style={{ marginBottom: "1.75rem" }}>
            {soon.map((thing) => {
              const meta = CATEGORY_META[thing.category];
              const due = dueMeta(thing, t);
              return (
                <button
                  key={thing.id}
                  className="listrow"
                  onClick={() => onOpenThing(thing)}
                >
                  <span
                    className="listrow__lead"
                    style={{ color: meta.color, background: tint(meta.color, TINT_SOFT), borderColor: tint(meta.color, TINT_BORDER) }}
                  >
                    <Icon name={KIND_ICON[thing.kind]} size={18} />
                  </span>
                  <span className="listrow__body">
                    <span className="listrow__title">{thing.name}</span>
                    <span className="listrow__sub">
                      {hasAmount(thing.amount) ? formatNaira(thing.amount) : t(`kind.${thing.kind}` as TKey)}
                    </span>
                  </span>
                  <span className="listrow__trail">
                    <span className={`badge ${TONE_CLASS[due.tone]}`}>{due.text}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      <p className="railtitle">{t("home.lifeAreas")}</p>
      <div className="grid grid--3">
        {(Object.keys(CATEGORY_META) as (keyof typeof CATEGORY_META)[]).map((id) => {
          const meta = CATEGORY_META[id];
          return (
            <div key={id} className="card card--quiet">
              <span
                className="tile__icon"
                style={{ color: meta.color, background: tint(meta.color, TINT_SOFT) }}
              >
                <Icon name={meta.icon} size={19} />
              </span>
              <p className="tile__label" style={{ marginTop: "0.5rem" }}>
                {t(meta.labelKey)}
              </p>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* --------------------------------------------------------- edit sheet host */

function QuickAddEditHost({
  thing,
  t,
  busy,
  onCancel,
  onSave,
}: {
  thing: Thing;
  t: ReturnType<typeof useLivanta>["t"];
  busy: boolean;
  onCancel: () => void;
  onSave: (values: ReturnType<typeof fromEditorValues>) => void;
}) {
  const [values, setValues] = useState(() => ({
    name: thing.name,
    category: thing.category,
    kind: thing.kind,
    amount: thing.amount === null ? "" : String(thing.amount),
    dueDate: thing.dueDate ?? "",
    frequency: thing.recurrence?.frequency ?? ("none" as const),
    notes: thing.notes ?? "",
  }));

  return (
    <Sheet title={t("things.edit")} onClose={onCancel}>
      <ThingEditor
        preset={{
          label: t(`kind.${thing.kind}` as TKey),
          kind: thing.kind,
          category: thing.category,
        }}
        initial={values}
        t={t}
        busy={busy}
        onSave={(v) => {
          setValues(v);
          onSave(fromEditorValues(v));
        }}
        onCancel={onCancel}
      />
    </Sheet>
  );
}

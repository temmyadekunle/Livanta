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
import { AuthScreen } from "./AuthScreen";
import Onboarding from "./Onboarding";
import ThingEditor from "./ThingEditor";
import { HomeScreen } from "./screens/HomeScreen";
import { CATEGORY_META, KIND_ICON, MODULE_ICON, MODULES, moduleThings, type ModuleId } from "./maps";
import { TINT_BORDER, TINT_SOFT, tint } from "@/lib/color";
import { dueMeta, TONE_CLASS } from "./labels";
import { formatDate } from "@/lib/dates";
import { formatNaira } from "@/lib/i18n";
import { hasAmount } from "@/lib/money";
import { notifyReminder, notifyUrgentAlert } from "@/lib/notifications";
import { planReminders } from "@/lib/reminders";
import { rescheduleReminders } from "@/lib/schedule";
import { fromEditorValues, type EditorPreset } from "@/lib/editor";
import InstallPrompt from "./InstallPrompt";
import type { TKey } from "@/lib/locales/en";
import type { Thing } from "@/lib/types";
import { useAuth } from "@/lib/useAuth";
import { useCloudSync } from "@/lib/useCloudSync";
import { greetingKeyFor, useDayPart } from "@/lib/useDayPart";
import { useLivanta } from "@/lib/useLivanta";

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

export default function LivantaApp() {
  const desk = useLivanta();
  const { t, refresh } = desk;
  const auth = useAuth();
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

const push = useCallback((route: Route) => setStack((s) => [...s, route]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  useEffect(() => {
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void App.addListener("backButton", () => {
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
  }, [confirmWipe, confirmThing, obAuthOpen, obStep, desk.settings.onboarded, quickOpen, openId, editId, stack, tab, pop]);

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
     only delivery. Reconciled wholesale on every data or settings change, so
     a deleted thing stops notifying without any bookkeeping here. The plan is
     recomputed inside the effect on data changes (cheap, pure) and the
     signature gate keeps that from turning into a cancel/reschedule loop. */
  const lastScheduled = useRef("");
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
    void rescheduleReminders(plan);
  }, [desk.ready, desk.things, desk.settings.notifyUrgent, desk.settings.leadDays, t]);

  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!desk.ready || !desk.settings.notifyUrgent) return;
    const urgent = desk.alerts.find((a) => a.priority === "urgent");
    if (urgent && notifyUrgentAlert(urgent, notified.current)) {
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
      if (notifyReminder(reminder, notified.current)) {
        notified.current.add(reminder.id);
      }
    }
  }, [
    desk.ready,
    desk.settings.notifyUrgent,
    desk.settings.leadDays,
    desk.alerts,
    desk.things,
    t,
    nowTick,
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

  async function saveNew(values: ReturnType<typeof fromEditorValues>) {
    setBusy(true);
    try {
      const thing = await desk.addThing(values);
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

  if (desk.ready && !desk.settings.onboarded) {
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
              onDemo={(locale) =>
                void desk
                  .completeOnboarding({
                    categories: [],
                    firstThings: [],
                    locale,
                  })
                  .then(() => desk.loadSampleData())
              }
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
                />
              </div>
            </>
          ) : null}
        </div>
        <Toast toast={toast} />
      </div>
    );
  }

  if (!desk.ready) {
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

  /* Someone following a reset link lands on the app root, not on the account
     screen, so the recovery session has to put that screen up by itself. Derived
     from auth state rather than pushed onto the stack, so it costs no extra
     render, and so the back chevron can be suppressed: a recovery session
     cannot sign in again without its token, so there is nowhere useful to
     return to and a live-looking back button would simply do nothing. */
const recovering = auth.passwordResetReady;
const route: Route | null = recovering
    ? { kind: "auth" }
    : (stack[stack.length - 1] ?? null);
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
          canGoBack={!recovering}
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
                  setTab("life");
                  openThing(thing);
                }}
              />
            ) : route?.kind === "auth" ? (
              <AuthScreen
                t={t}
                auth={auth}
                onClose={pop}
                onDone={(message) => showToast(message, "ok")}
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
  canGoBack,
  onBack,
  onOpenAlerts,
  onOpenProfile,
}: {
  desk: ReturnType<typeof useLivanta>;
  tab: Tab;
route: Route | null;
  /** False for a derived route, such as password recovery, that cannot be popped. */
  canGoBack: boolean;
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
        {route && canGoBack ? (
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

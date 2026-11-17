"use client";

import { Avatar } from "../Avatar";
import { Icon } from "../Icons";
import { EmptyState, IconTile } from "../ui";
import { alertTone, dueMeta, TONE_CLASS } from "../labels";
import { CATEGORY_META, KIND_ICON, MODULE_ICON } from "../maps";
import { TINT_SOFT, tint } from "@/lib/color";
import { QUICK_TYPES } from "../QuickAdd";
import { formatNaira } from "@/lib/i18n";
import { hasAmount } from "@/lib/money";
import { firstName, greetingKeyFor, useDayPart } from "@/lib/useDayPart";
import type { Alert, Priority, Thing } from "@/lib/types";
import type { DayDiff } from "@/lib/risk";
import type { useLivanta } from "@/lib/useLivanta";
import type { EditorPreset } from "@/lib/editor";
import { MODULES, type ModuleId } from "../maps";

type Desk = ReturnType<typeof useLivanta>;

export function HomeScreen({
  desk,
  onOpenThing,
  onAdd,
  onAddMore,
  onOpenModule,
  onOpenAlerts,
  onOpenCalendar,
  onOpenLife,
}: {
  desk: Desk;
  onOpenThing: (thing: Thing) => void;
  onAdd: (preset?: EditorPreset) => void;
  onAddMore: () => void;
  onOpenModule: (id: ModuleId) => void;
  onOpenAlerts: () => void;
  onOpenCalendar: () => void;
  onOpenLife: () => void;
}) {
  const { t } = desk;
  const attention = desk.alerts.slice(0, 3);
  const spotlight = QUICK_TYPES.slice(0, 4);

  return (
    <>
      <Hero desk={desk} />

      <section className="section">
        <div className="statgrid">
          <Stat n={desk.status.urgentCount} label={t("home.stat.urgent")} tone="urgent" />
          <Stat n={desk.status.importantCount} label={t("home.stat.important")} tone="important" />
          <Stat n={desk.status.onTrackCount} label={t("home.stat.onTrack")} tone="routine" />
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("home.needsAttention")}</h2>
          {desk.alerts.length > attention.length ? (
            <button className="section__link" onClick={onOpenAlerts}>
              {t.n("home.seeAllCount", desk.alerts.length)}
              <Icon name="chevronRight" size={14} />
            </button>
          ) : null}
        </div>

        {desk.loading ? (
          <div className="card">
            <p className="card-meta">{t("home.reading")}</p>
          </div>
        ) : attention.length === 0 ? (
          desk.things.length === 0 ? (
            <EmptyState
              icon="sparkles"
              title={t("home.freshTitle")}
              body={t("home.freshBody")}
              action={
                <button className="btn btn--soft" onClick={() => onAdd()}>
                  <Icon name="plus" size={18} />
                  {t("home.freshAction")}
                </button>
              }
            />
          ) : (
            <EmptyState
              icon="shieldCheck"
              title={t("home.allClearTitle")}
              body={t("home.allClearBody")}
              action={
                <button className="btn btn--soft" onClick={() => onAdd()}>
                  <Icon name="plus" size={18} />
                  {t("home.quickAdd")}
                </button>
              }
            />
          )
        ) : (
          <>
            <p className="attention-lead">
              {t.n("home.attentionLead", desk.alerts.length)}
            </p>
            <div className="stack stack--tight">
              {attention.map((a) => (
                <AlertCard key={a.id} alert={a} desk={desk} onOpen={onOpenThing} />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("home.comingSoon")}</h2>
          <button className="section__link" onClick={onOpenCalendar}>
            {t("home.openCalendar")}
            <Icon name="chevronRight" size={14} />
          </button>
        </div>

        {desk.totals.items.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={t("home.nothing30Title")}
            body={t("home.nothing30")}
            action={
              <button className="btn btn--soft" onClick={onOpenLife}>
                {t("tab.life")}
              </button>
            }
          />
        ) : (
          <div className="list">
            {desk.totals.items.slice(0, 4).map((thing) => (
              <ThingLine key={thing.id} thing={thing} desk={desk} onOpen={onOpenThing} />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("home.quickAdd")}</h2>
          <button className="section__link" onClick={onAddMore}>
            {t("home.more")}
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
        <div className="grid grid--4">
          {spotlight.map((qt) => (
            <button
              key={qt.key}
              className="tile"
              onClick={() =>
                onAdd({ label: t(qt.key), kind: qt.kind, category: qt.category })
              }
            >
              <span
                className="tile__icon"
                style={{ color: qt.color, background: tint(qt.color, TINT_SOFT) }}
              >
                <Icon name={qt.icon} size={19} />
              </span>
              <span className="tile__label">{t(qt.key)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("home.lifeAreas")}</h2>
          <button className="section__link" onClick={onOpenLife}>
            {t("tab.life")}
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
        <div className="module-grid">
          {MODULES.map((m) => (
            <button
              key={m.id}
              className="module"
              onClick={() => onOpenModule(m.id)}
            >
              <span
                className="module-ico"
                style={{ color: m.color, background: tint(m.color, TINT_SOFT) }}
              >
                <Icon name={MODULE_ICON[m.id]} size={19} />
              </span>
              <span className="module-label">{t(m.labelKey)}</span>
              <span className="module-blurb">{t(m.blurbKey)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="card card--quiet">
          <div className="rowline">
            <span className="listrow__lead" style={{ color: "var(--money)" }}>
              <Icon name="wallet" size={19} />
            </span>
            <div className="listrow__body">
              <p className="section-label" style={{ margin: 0 }}>
                {t("home.commitments")}
              </p>
              <div className="amount">{formatNaira(desk.totals.total)}</div>
            </div>
          </div>
          <p className="card-meta" style={{ marginTop: "0.5rem" }}>
            {t.n("home.next30", desk.totals.count)}
          </p>
        </div>
      </section>
    </>
  );
}

function Hero({ desk }: { desk: Desk }) {
  const { t } = desk;
  const name = desk.settings.displayName;
  const greetingName = firstName(name);
  // Subscribed rather than read once, so an app left open across lunchtime
  // stops saying "Good morning" without needing to be closed and reopened.
  const part = useDayPart();
  return (
    <div className="hero">
      <div className="hero__top">
        <Avatar name={name} src={desk.settings.avatar} />
      </div>
      <p className="hero__greet">
        {t(greetingKeyFor(part, greetingName), { name: greetingName })}
      </p>
      <p className="hero__line">
        {desk.loading ? t("app.loading") : t("home.heroLine")}
      </p>
      <span className={`statuspill ${levelClass(desk.status.level)}`}>
        <span className="dot" />
        {desk.status.label}
      </span>
    </div>
  );
}

function levelClass(level: string): string {
  if (level === "stable") return "level-stable";
  if (level === "needs-attention") return "level-attention";
  return "level-immediate";
}

function Stat({ n, label, tone }: { n: number; label: string; tone: Priority }) {
  return (
    <div className="stat">
      <div className={`stat-num ${tone}`}>{n}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function AlertCard({
  alert,
  desk,
  onOpen,
}: {
  alert: Alert;
  desk: Desk;
  onOpen: (thing: Thing) => void;
}) {
  const { t } = desk;
  const tone = alertTone(alert);
  const meta = CATEGORY_META[alert.category];
  const thing = desk.things.find((x) => x.id === alert.thingId);

  return (
    <div className={`card card--${tone === "urgent" ? "urgent" : tone === "warn" ? "warn" : "quiet"}`}>
      <div className="rowline" style={{ alignItems: "flex-start" }}>
        <IconTile icon={KIND_ICON[alert.kind]} color={meta.color} size={18} />
        <div className="listrow__body">
          <p className="listrow__title" style={{ whiteSpace: "normal" }}>
            {alert.title}
          </p>
          <p className="listrow__sub" style={{ whiteSpace: "normal" }}>
            {alert.message}
          </p>
        </div>
      </div>
      <div className="chips" style={{ marginTop: "0.625rem" }}>
        <span className={`badge ${TONE_CLASS[tone]}`}>
          {t(`priority.${alert.priority}` as never)}
        </span>
      </div>
      <div className="quick-grid" style={{ marginTop: "0.625rem" }}>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => void desk.dismissAlert(alert)}
        >
          <Icon name="bellOff" size={16} />
          {t("action.remindLater")}
        </button>
        <button
          className="btn btn--primary btn--sm"
          disabled={!thing}
          onClick={() => thing && onOpen(thing)}
        >
          <Icon name="arrowRight" size={16} />
          {t("action.review")}
        </button>
      </div>
    </div>
  );
}

export function ThingLine({
    thing,
    desk,
    onOpen,
    now,
    dayDiff,
  }: {
    thing: Thing;
    desk: Desk;
    onOpen: (thing: Thing) => void;
    /**
     * Overrides the clock when the row is rendered outside the live app.
     *
     * The landing page reuses this component inside its phone mockups, and a
     * statically exported page is built once and then opened on any date. Left
     * to its own devices this component would print "Due in 2 days" into the
     * HTML at build time and then print a different number when the reader's
     * browser hydrated it, which React reports as a hydration mismatch. Passing
     * one fixed instant plus a timezone-independent `dayDiff` makes the two
     * renders agree.
     *
     * Both default to the real clock, so the app itself is unaffected.
     */
    now?: Date;
    dayDiff?: DayDiff;
  }) {
    const { t } = desk;
    const meta = CATEGORY_META[thing.category];
    const due = dueMeta(thing, t, now, dayDiff);

  return (
    <button className="listrow" onClick={() => onOpen(thing)}>
      <IconTile icon={KIND_ICON[thing.kind]} color={meta.color} size={18} />
      <span className="listrow__body">
        <span className="listrow__title">{thing.name}</span>
        <span className="listrow__sub">
          {t(`kind.${thing.kind}` as never)}
          {hasAmount(thing.amount) ? ` · ${formatNaira(thing.amount)}` : ""}
        </span>
      </span>
      <span className="listrow__trail">
        <span className={`badge ${TONE_CLASS[due.tone]}`}>{due.text}</span>
      </span>
    </button>
  );
}
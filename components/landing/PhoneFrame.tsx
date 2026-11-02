"use client";

/**
 * Phone mockups for the landing page.
 *
 * These render the real screens. HomeScreen, ThingsScreen and the rest are
 * imported directly and fed the showcase data, so what appears on the marketing
 * page is produced by the same code that produces the shipped app. If a card in
 * the app changes, the mockup changes with it, which is the only way a product
 * screenshot stays honest over time.
 *
 * The alternative, hand-writing markup that looks like the app, drifts within a
 * release or two and then quietly misrepresents the product.
 */
import { ThingLine } from "@/components/screens/HomeScreen";
import { ThingsScreen } from "@/components/screens/ThingsScreen";
import { Icon } from "@/components/Icons";
import { IconTile, EmptyState } from "@/components/ui";
import { CATEGORY_META, KIND_ICON, MODULE_ICON, MODULES } from "@/components/maps";
import { dueMeta, TONE_CLASS } from "@/components/labels";
import { makeShowcase } from "@/lib/landing/showcase";
import { dayPart } from "@/lib/dates";
import { greetingKey } from "@/lib/useDayPart";
import { utcDaysUntil } from "@/lib/risk";
import type { Category } from "@/lib/types";
import { formatNaira } from "@/lib/i18n";
import { hasAmount } from "@/lib/money";
import type { ModuleId } from "@/components/maps";

const TABS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "life", label: "Life", icon: "layers" },
  { id: "alerts", label: "Alerts", icon: "bell" },
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "profile", label: "Profile", icon: "user" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Shared no-ops: the mockups are a picture, not a second working copy. */
const inert = () => {};

/**
 * The device frame. Purely presentational, so it is a plain div rather than a
 * component with state: the outer page controls which screen is showing.
 */
export function PhoneFrame({
  children,
  tab,
  label,
}: {
  children: React.ReactNode;
  tab: TabId;
  label: string;
}) {
  return (
    <div className="lp-phone" role="img" aria-label={label}>
      <div className="lp-phone__frame">
        <div className="lp-phone__notch" aria-hidden="true" />
        <div className="lp-phone__screen">
          <div className="lp-phone__statusbar" aria-hidden="true">
            <span>9:41</span>
            <span className="lp-phone__statusright">
              <span className="lp-signal" />
              <span className="lp-signal" />
              <span className="lp-signal" />
              <Icon name="cloud" size={12} />
              <Icon name="zap" size={12} />
            </span>
          </div>
          {/* `inert` keeps the real screen's inputs and buttons out of the tab
              order and the click path: this is a picture of the app, not a
              second working copy. The captions sit outside it, so they stay
              readable to assistive tech. */}
          <div className="lp-phone__body" inert>{children}</div>
          <nav className="lp-bottomnav" aria-hidden="true">
            {TABS.map((t) => (
              <span
                key={t.id}
                className={`lp-bottomnav__item${t.id === tab ? " is-on" : ""}`}
              >
                <Icon name={t.icon} size={17} />
                <span className="lp-bottomnav__label">{t.label}</span>
              </span>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

/**
 * A mockup is a picture of the app, not a second working copy, so every screen
 * below takes the build-time clock and rebuilds the showcase from it. Passing
 * one `now` through the whole page is what keeps the server HTML and the
 * hydrated DOM identical; see lib/landing/showcase.ts for the full reason.
 */
export function PhoneHome({ now }: { now: Date }) {
  const { desk, alerts, dayDiff } = makeShowcase(now);
  const attention = alerts.slice(0, 2);
  const spotlight = desk.totals.items.slice(0, 4);

  return (
    <>
      <div className="hero hero--mock">
        <div className="hero__top">
          <span className="appbar__brand" style={{ color: "rgba(255,255,255,0.85)" }}>
            Livanta
          </span>
        </div>
        {/* The greeting follows the same dayPart helper as the real home
            screen, evaluated against the build's own `now`. A hardcoded
            "Good morning" here would quietly contradict the app for anyone
            reading the page in the evening. */}
        <p className="hero__greet">
          {desk.t(greetingKey(dayPart(now)), { name: "Temmy" })}
        </p>
        <p className="hero__line">{desk.status.headline}</p>
        <span
          className={`statuspill ${
            desk.status.level === "stable"
              ? "level-stable"
              : desk.status.level === "needs-attention"
                ? "level-attention"
                : "level-immediate"
          }`}
        >
          <span className="dot" />
          {desk.status.label}
        </span>
      </div>

      <section className="section">
        <div className="statgrid">
          <div className="stat">
            <div className="stat-num urgent">{desk.status.urgentCount}</div>
            <div className="stat-label">{desk.t("home.stat.urgent")}</div>
          </div>
          <div className="stat">
            <div className="stat-num important">{desk.status.importantCount}</div>
            <div className="stat-label">{desk.t("home.stat.important")}</div>
          </div>
          <div className="stat">
            <div className="stat-num routine">{desk.status.onTrackCount}</div>
            <div className="stat-label">{desk.t("home.stat.onTrack")}</div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{desk.t("home.needsAttention")}</h2>
        </div>
        <div className="stack stack--tight">
          {attention.map((a) => (
            <div
              key={a.id}
              className={`card card--${
                a.priority === "urgent" ? "urgent" : a.priority === "important" ? "warn" : "quiet"
              }`}
            >
              <div className="rowline" style={{ alignItems: "flex-start" }}>
                <IconTile
                  icon={KIND_ICON[a.kind]}
                  color={CATEGORY_META[a.category].color}
                  size={18}
                />
                <div className="listrow__body">
                  <p className="listrow__title" style={{ whiteSpace: "normal" }}>
                    {a.title}
                  </p>
                  <p className="listrow__sub" style={{ whiteSpace: "normal" }}>
                    {a.message}
                  </p>
                </div>
              </div>
              <div className="chips" style={{ marginTop: "0.625rem" }}>
                <span className={`badge ${TONE_CLASS[a.priority === "urgent" ? "urgent" : "warn"]}`}>
                  {desk.t(`priority.${a.priority}`)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{desk.t("home.comingSoon")}</h2>
        </div>
        <div className="list">
          {spotlight.map((thing) => (
            <ThingLine key={thing.id} thing={thing} desk={desk} onOpen={inert} now={now} dayDiff={dayDiff} />
          ))}
        </div>
      </section>
    </>
  );
}

/** The real list screen, with its search and filter row intact. */
export function PhoneThings({ now }: { now: Date }) {
  return (
    <ThingsScreen
      desk={makeShowcase(now).desk}
      onOpenThing={inert}
      onAdd={inert}
      now={now}
      dayDiff={utcDaysUntil}
    />
  );
}

/**
 * The calendar month, built from the same grouping the app uses rather than a
 * hand-drawn grid, so a month that starts on the right weekday is correct by
 * construction.
 */
export function PhoneCalendar({ now }: { now: Date }) {
  const { things, desk, dayDiff } = makeShowcase(now);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = now.getUTCDate();

  // Monday-first, matching how the app's agenda groups days.
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday === 0 ? 6 : firstWeekday - 1 }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // A day is marked when something in the showcase data falls on it.
  const busy = new Set<number>();
  for (const thing of things) {
    if (!thing.dueDate) continue;
    const [y, m, d] = thing.dueDate.split("-").map(Number);
    if (y === year && m - 1 === month) busy.add(d);
  }

  const monthName = new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <>
      <div className="appbar">
        <div className="appbar__actions">
          <span className="section-label">Calendar</span>
        </div>
      </div>
      <section className="section">
        <div className="card">
          <p className="section-label" style={{ margin: "0 0 0.75rem" }}>
            {monthName}
          </p>
          <div className="lp-cal">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i} className="lp-cal__dow">
                {d}
              </span>
            ))}
            {cells.map((day, i) => (
              <span
                key={i}
                className={[
                  "lp-cal__day",
                  day === null ? "is-empty" : "",
                  day === today ? "is-today" : "",
                  day !== null && busy.has(day) ? "has-item" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {day ?? ""}
              </span>
            ))}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{desk.t("home.thisWeek")}</h2>
        </div>
        <div className="list">
          {desk.totals.items.slice(0, 3).map((thing) => (
            <ThingLine
              key={thing.id}
              thing={thing}
              desk={desk}
              onOpen={inert}
              now={now}
              dayDiff={dayDiff}
            />
          ))}
        </div>
      </section>
    </>
  );
}

/** A category screen, matching ModuleScreen's shape for one module. */
export function PhoneModule({ moduleId, now }: { moduleId: ModuleId; now: Date }) {
  const meta = MODULES.find((m) => m.id === moduleId) ?? MODULES[0];
  const { things, desk, dayDiff } = makeShowcase(now);
  const items = things.filter((x) => {
    const byCategory: Record<ModuleId, Category[]> = {
      home: ["home"],
      vehicles: ["transport"],
      bills: ["money"],
      documents: ["documents"],
      assets: ["home", "transport"],
    };
    return byCategory[moduleId].includes(x.category);
  });

  return (
    <>
      <div className="appbar">
        <div className="appbar__actions">
          <Icon name="chevronLeft" size={18} />
          <span className="section-label" style={{ margin: 0 }}>
            {desk.t(meta.labelKey)}
          </span>
        </div>
      </div>
      <section className="section">
        <div className="module-grid">
          <div className="module is-open">
            <span
              className="module-ico"
              style={{
                color: meta.color,
                background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
              }}
            >
              <Icon name={MODULE_ICON[meta.id]} size={19} />
            </span>
            <span className="module-label">{desk.t(meta.labelKey)}</span>
            <span className="module-blurb">{desk.t(meta.blurbKey)}</span>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {desk.t.n("things.count", items.length)}
          </h2>
        </div>
        {items.length === 0 ? (
          <div className="card">
            <p className="card-meta">{desk.t("things.emptyBody")}</p>
          </div>
        ) : (
          <div className="list">
            {items.map((thing) => (
              <ThingLine key={thing.id} thing={thing} desk={desk} onOpen={inert} now={now} dayDiff={dayDiff} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** The quick-add editor, showing the real field layout. */
export function PhoneAdd() {
  return (
    <>
      <div className="appbar">
        <div className="appbar__actions">
          <Icon name="chevronLeft" size={18} />
          <span className="section-label" style={{ margin: 0 }}>
            Add something
          </span>
        </div>
      </div>
      <section className="section">
        <div className="grid grid--4">
          {[
            { icon: "receipt" as const, label: "Bill", color: "var(--money)" },
            { icon: "file" as const, label: "Document", color: "var(--documents)" },
            { icon: "car" as const, label: "Vehicle", color: "var(--transport)" },
            { icon: "calendar" as const, label: "Reminder", color: "var(--home)" },
          ].map((item) => (
            <span key={item.label} className="tile">
              <span
                className="tile__icon"
                style={{ color: item.color, background: "color-mix(in srgb, currentColor 12%, transparent)" }}
              >
                <Icon name={item.icon} size={19} />
              </span>
              <span className="tile__label">{item.label}</span>
            </span>
          ))}
        </div>
      </section>
      <section className="section">
        <div className="card">
          <label className="field">
            <span className="field__label">What is it?</span>
            <span className="field__input">Vehicle insurance</span>
          </label>
          <label className="field">
            <span className="field__label">How much?</span>
            <span className="field__input">₦85,000</span>
          </label>
          <label className="field">
            <span className="field__label">When is it due?</span>
            <span className="field__input">In 12 days</span>
          </label>
        </div>
      </section>
    </>
  );
}

/** The alerts screen, reusing the real alert cards. */
export function PhoneAlerts({ now }: { now: Date }) {
  // No dayDiff here: makeShowcase already handed it to buildAlerts, which is
  // where the "in 2 days" wording in these messages comes from.
  const { desk, alerts } = makeShowcase(now);
  return (
    <>
      <div className="appbar">
        <div className="appbar__actions">
          <span className="section-label">{desk.t("alerts.title")}</span>
        </div>
      </div>
      <section className="section">
        {alerts.length === 0 ? (
          <EmptyState
            icon="shieldCheck"
            title={desk.t("home.allClearTitle")}
            body={desk.t("home.allClearBody")}
          />
        ) : (
          <div className="stack stack--tight">
            {alerts.slice(0, 4).map((a) => (
              <div
                key={a.id}
                className={`card card--${
                  a.priority === "urgent"
                    ? "urgent"
                    : a.priority === "important"
                      ? "warn"
                      : "quiet"
                }`}
              >
                <div className="rowline" style={{ alignItems: "flex-start" }}>
                  <IconTile
                    icon={KIND_ICON[a.kind]}
                    color={CATEGORY_META[a.category].color}
                    size={18}
                  />
                  <div className="listrow__body">
                    <p className="listrow__title" style={{ whiteSpace: "normal" }}>
                      {a.title}
                    </p>
                    <p className="listrow__sub" style={{ whiteSpace: "normal" }}>
                      {a.message}
                    </p>
                  </div>
                </div>
                <div className="chips" style={{ marginTop: "0.625rem" }}>
                  <span className={`badge ${TONE_CLASS[a.priority === "urgent" ? "urgent" : a.priority === "important" ? "warn" : "info"]}`}>
                    {desk.t(`priority.${a.priority}`)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/**
 * The upcoming list used in the "what's about to become a problem" section.
 * Composed here rather than reusing PhoneHome so the rows can carry the
 * category, deadline and time remaining the copy promises.
 */
export function UpcomingTable({ now }: { now: Date }) {
  const { things, desk, dayDiff } = makeShowcase(now);
  const rows = things
    .filter((x) => x.dueDate && x.status === "active")
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 5);

  return (
    <ul className="lp-upcoming">
      {rows.map((thing) => {
        const meta = CATEGORY_META[thing.category];
        const due = dueMeta(thing, desk.t, now, dayDiff);
        return (
          <li key={thing.id} className="lp-upcoming__row">
            <IconTile icon={KIND_ICON[thing.kind]} color={meta.color} size={18} />
            <span className="lp-upcoming__body">
              <span className="lp-upcoming__title">{thing.name}</span>
              <span className="lp-upcoming__meta">
                {desk.t(meta.labelKey)}
                {hasAmount(thing.amount) ? ` · ${formatNaira(thing.amount)}` : ""}
              </span>
            </span>
            <span className="lp-upcoming__trail">
              <span className={`badge ${TONE_CLASS[due.tone]}`}>{due.text}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import { Fragment } from "react";
import { useMemo, useState } from "react";

import { Icon } from "../Icons";
import { EmptyState } from "../ui";
import { CATEGORY_META, KIND_ICON } from "../maps";
import { TINT_SOFT, tint } from "@/lib/color";
import { dueMeta, TONE_CLASS } from "../labels";
import { formatNaira } from "@/lib/i18n";
import { hasAmount } from "@/lib/money";
import { addMonths, formatDate, formatMonthYear, toISO, monthMatrix, weekdayInitials } from "@/lib/dates";
import { type DayDiff } from "@/lib/risk";
import { TINT_BORDER } from "@/lib/color";
import { parseISO } from "@/lib/dates";
import type { Thing } from "@/lib/types";
import type { useLivanta } from "@/lib/useLivanta";
import type { TKey } from "@/lib/locales/en";

type Desk = ReturnType<typeof useLivanta>;

export function CalendarScreen({
  desk,
  onOpenThing,
  onAdd,
  now,
  dayDiff,
}: {
  desk: Desk;
  onOpenThing: (thing: Thing) => void;
  onAdd: () => void;
  /** See ThingLine's docs: pins the clock for the static mockups. */
  now?: Date;
  /** See ThingLine's dayDiff. */
  dayDiff?: DayDiff;
}) {
  const { t } = desk;
  // A pinned clock must drive the grid and selection, not only the due labels.
  const today = now ?? new Date();
  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selected, setSelected] = useState(() => toISO(today));

  const byDate = useMemo(() => {
    const map = new Map<string, Thing[]>();
    for (const thing of desk.things) {
      if (thing.status === "active" && thing.dueDate) {
        const list = map.get(thing.dueDate) ?? [];
        list.push(thing);
        map.set(thing.dueDate, list);
      }
    }
    return map;
  }, [desk.things]);

  const cells = useMemo(() => monthMatrix(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const dow = useMemo(() => weekdayInitials(t.locale), [t.locale]);
  const todayIso = toISO(today);

  const selectedItems = byDate.get(selected) ?? [];

  const upcoming = useMemo(
    () =>
      desk.things
        .filter((thing) => thing.status === "active" && thing.dueDate && thing.dueDate >= todayIso)
        .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
        .slice(0, 5),
    [desk.things, todayIso],
  );

  return (
    <>
      <div className="month">
        <div className="month__head">
          <button
            type="button"
            className="iconbtn"
            onClick={() => setCursor(addMonths(cursor, -1))}
            aria-label={t("cal.prevMonth")}
          >
            <Icon name="chevronLeft" size={20} />
          </button>
          <h2 className="month__title">{formatMonthYear(cursor, t.locale)}</h2>
          <button
            type="button"
            className="iconbtn"
            onClick={() => setCursor(addMonths(cursor, 1))}
            aria-label={t("cal.nextMonth")}
          >
            <Icon name="chevronRight" size={20} />
          </button>
        </div>

        <div className="month__dow" aria-hidden="true">
          {dow.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>

        <div className="month__grid" role="group" aria-label={t("cal.title")}>
          {cells.map((date) => {
            const iso = toISO(date);
            const items = byDate.get(iso) ?? [];
            const classes = [
              "day",
              date.getMonth() !== cursor.getMonth() ? "day--out" : "",
              iso === todayIso ? "day--today" : "",
              iso === selected ? "day--on" : "",
            ]
              .filter(Boolean)
              .join(" ");

            const itemCount = items.length;
            const urgentCount = items.filter((i) => i.priority === "urgent").length;
            const dotLabel = itemCount > 0
              ? `${itemCount} item${itemCount > 1 ? "s" : ""}${urgentCount > 0 ? `, ${urgentCount} urgent` : ""}`
              : "";

            return (
              <button
                key={iso}
                type="button"
                className={classes}
                onClick={() => setSelected(iso)}
                aria-pressed={iso === selected}
                aria-label={dotLabel
                  ? `${formatDate(date, t.locale, { day: "numeric", month: "long" })}, ${dotLabel}`
                  : formatDate(date, t.locale, { day: "numeric", month: "long" })}
                  aria-current={iso === todayIso ? "date" : undefined}
                >
                  {date.getDate()}
                  {items.length > 0 ? (
                    <span className="day__dots" aria-hidden="true">
                      {items.slice(0, 3).map((item) => (
                        <span
                          key={item.id}
                          className={`day__dot${item.priority === "urgent" ? " day__dot--urgent" : ""}`}
                        />
                      ))}
                    </span>
                  ) : null}
                </button>
            );
          })}
        </div>

        <button
          type="button"
          className="btn btn--soft btn--block btn--sm"
          style={{ marginTop: "0.625rem" }}
          onClick={() => {
            setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
            setSelected(todayIso);
          }}
        >
          <Icon name="target" size={16} />
          {t("cal.jumpToday")}
        </button>
      </div>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {formatDate(parseISO(selected), t.locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h2>
        </div>

        {selectedItems.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={t("cal.emptyTitle")}
            body={t("cal.emptyBody")}
            action={
              <button className="btn btn--soft" onClick={onAdd}>
                <Icon name="plus" size={18} />
                {t("home.quickAdd")}
              </button>
            }
          />
        ) : (
          <div className="list">
            {selectedItems.map((thing) => {
              const meta = CATEGORY_META[thing.category];
              const due = dueMeta(thing, t, now, dayDiff);
              return (
                <button
                  key={thing.id}
                  className="listrow"
                  onClick={() => onOpenThing(thing)}
                >
                  <span
                    className="listrow__lead"
                    style={{
                      color: meta.color,
                      background: tint(meta.color, TINT_SOFT),
                      borderColor: tint(meta.color, TINT_BORDER),
                    }}
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
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">{t("cal.upcoming")}</h2>
          </div>
          <div className="list">
            {upcoming.map((thing) => {
              const meta = CATEGORY_META[thing.category];
              const due = dueMeta(thing, t, now, dayDiff);
              return (
                <button
                  key={thing.id}
                  className="listrow"
                  onClick={() => onOpenThing(thing)}
                >
                  <span
                    className="listrow__lead"
                    style={{
                      color: meta.color,
                      background: tint(meta.color, TINT_SOFT),
                      borderColor: tint(meta.color, TINT_BORDER),
                    }}
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
        </section>
      )}
    </>
  );
}
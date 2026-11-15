"use client";

import { useState } from "react";

import { Icon, type IconName } from "./Icons";
import { Logo } from "./Logo";
import { CATEGORY_META } from "./maps";
import { LOCALES, LOCALE_NAMES, makeT, type Locale, type Translate } from "@/lib/i18n";
import type { TKey } from "@/lib/locales/en";
import type { Category, ThingKind } from "@/lib/types";
import { TINT_SOFT, tint } from "@/lib/color";
import { announcePermissionChange, requestNotificationPermission } from "@/lib/notifications";

export interface OnboardingResult {
  categories: Category[];
  firstThings: {
    name: string;
    category: Category;
    kind: ThingKind;
    dueDate: string;
  }[];
  locale: Locale;
}

export function LocalePicker({
  locale,
  onChange,
  t,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  t: Translate;
}) {
  return (
    <div className="chips" role="group" aria-label={t("ob.language")}>
      {LOCALES.map((id) => (
        <button
          key={id}
          type="button"
          lang={id}
          className={id === locale ? "chip chip--on" : "chip"}
          aria-pressed={id === locale}
          onClick={() => onChange(id)}
        >
          <Icon name="globe" size={15} />
          {LOCALE_NAMES[id]}
        </button>
      ))}
    </div>
  );
}

const OPTIONS: { id: Category; labelKey: TKey; icon: IconName; color: string }[] = (
  Object.keys(CATEGORY_META) as Category[]
).map((id) => ({ id, ...CATEGORY_META[id] }));

const HOW_CARDS: {
  icon: IconName;
  color: string;
  titleKey: TKey;
  bodyKey: TKey;
}[] = [
  {
    icon: "bell",
    color: "var(--warn)",
    titleKey: "ob.remember",
    bodyKey: "ob.rememberBody",
  },
  {
    icon: "checkCircle",
    color: "var(--ok)",
    titleKey: "ob.notified",
    bodyKey: "ob.notifiedBody",
  },
  {
    icon: "layers",
    color: "var(--brand-700)",
    titleKey: "ob.organized",
    bodyKey: "ob.organizedBody",
  },
];

const EXAMPLES: {
  id: string;
  nameKey: TKey;
  dateKey: TKey;
  icon: IconName;
  color: string;
  category: Category;
  kind: ThingKind;
}[] = [
  {
    id: "insurance",
    nameKey: "ob.ex.vehicle",
    dateKey: "ob.ex.expires",
    icon: "car",
    color: "var(--transport)",
    category: "transport",
    kind: "insurance",
  },
  {
    id: "power",
    nameKey: "ob.ex.power",
    dateKey: "ob.ex.due",
    icon: "zap",
    color: "var(--money)",
    category: "money",
    kind: "utility",
  },
  {
    id: "passport",
    nameKey: "ob.ex.passport",
    dateKey: "ob.ex.expires",
    icon: "file",
    color: "var(--documents)",
    category: "documents",
    kind: "document",
  },
];

const STEPS = [0, 1, 2, 3, 4];

export default function Onboarding({
  locale: initialLocale,
  step,
  onStepChange,
  onDone,
  onSignIn,
  onDemo,
}: {
  locale: Locale;
  step: number;
  onStepChange: (step: number) => void;
  onDone: (result: OnboardingResult) => void;
  onSignIn: () => void;
  onDemo?: (locale: Locale) => void;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [picked, setPicked] = useState<Category[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});

  const t = makeT(locale);

  function toggle(id: Category) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  function finish() {
    onDone({
      categories: picked,
      firstThings: EXAMPLES.flatMap((e) => {
        const dueDate = dates[e.id];
        return dueDate
          ? [{ name: t(e.nameKey), category: e.category, kind: e.kind, dueDate }]
          : [];
      }),
      locale,
    });
  }

  async function allowNotifications() {
    await requestNotificationPermission();
    announcePermissionChange();
    finish();
  }

  return (
    <div className="ob" lang={locale}>
      <div className="ob-brand">
        <Logo variant="wordmark" priority />
        <h1>{t("app.brand")}</h1>
        <p>{t("app.tagline")}</p>
      </div>

      <div className="ob-steps" role="presentation">
        {STEPS.map((i) => (
          <span key={i} className={step === i ? "ob-step ob-step--on" : "ob-step"} />
        ))}
      </div>

      {step === 0 ? (
        <>
          <h2 className="ob-h">{t("ob.welcome")}</h2>
          <p className="card-meta" style={{ marginBottom: "0.875rem" }}>
            {t("ob.lead")}
          </p>

          <div className="field">
            <span>{t("ob.language")}</span>
            <LocalePicker locale={locale} onChange={setLocale} t={t} />
          </div>

          <button
            className="btn btn--primary btn--lg btn--block"
            style={{ marginTop: "0.25rem" }}
            onClick={() => onStepChange(1)}
          >
            {t("ob.getStarted")}
            <Icon name="arrowRight" size={18} />
          </button>

          <button
            className="btn btn--ghost btn--block"
            style={{ marginTop: "0.5rem" }}
            onClick={onSignIn}
          >
            {t("ob.signInAccount")}
          </button>

          <button
            className="btn btn--ghost btn--block"
            style={{ marginTop: "0.5rem" }}
            onClick={() => onDemo?.(locale)}
          >
            {t("ob.demo")}
          </button>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <h2 className="ob-h">{t("ob.howTitle")}</h2>
          <p className="card-meta" style={{ marginBottom: "0.875rem" }}>
            {t("ob.howBody")}
          </p>

          <div className="stack stack--tight">
            {HOW_CARDS.map((c) => (
              <div className="card card--quiet" key={c.titleKey}>
                <div className="rowline">
                  <span
                    className="listrow__lead"
                    style={{ color: c.color, background: tint(c.color, TINT_SOFT) }}
                  >
                    <Icon name={c.icon} size={19} />
                  </span>
                  <div className="listrow__body">
                    <p className="listrow__title">{t(c.titleKey)}</p>
                    <p className="listrow__sub" style={{ whiteSpace: "normal" }}>
                      {t(c.bodyKey)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="quick-grid" style={{ marginTop: "1rem" }}>
            <button className="btn btn--secondary" onClick={() => onStepChange(0)}>
              {t("ob.back")}
            </button>
            <button className="btn btn--primary" onClick={() => onStepChange(2)}>
              {t("ob.continue")}
            </button>
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h2 className="ob-h">{t("ob.whatManage")}</h2>
          <p className="card-meta" style={{ marginBottom: "0.875rem" }}>
            {t("ob.pickAll")}
          </p>

          <div className="grid grid--2">
            {OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                className="tile"
                aria-pressed={picked.includes(o.id)}
                onClick={() => toggle(o.id)}
                style={
                  picked.includes(o.id)
                    ? { borderColor: o.color, background: tint(o.color, 5) }
                    : undefined
                }
              >
                <span
                  className="tile__icon"
                  style={{ color: o.color, background: tint(o.color, TINT_SOFT) }}
                >
                  <Icon name={o.icon} size={19} />
                </span>
                <span className="tile__label">{t(o.labelKey)}</span>
                {picked.includes(o.id) ? (
                  <span
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      color: o.color,
                    }}
                  >
                    <Icon name="checkCircle" size={18} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="quick-grid" style={{ marginTop: "1rem" }}>
            <button className="btn btn--secondary" onClick={() => onStepChange(1)}>
              {t("ob.back")}
            </button>
            <button
              className="btn btn--primary"
              onClick={() => onStepChange(3)}
              disabled={picked.length === 0}
            >
              {t("ob.continue")}
            </button>
          </div>

          <button
            className="btn btn--ghost btn--block"
            style={{ marginTop: "0.5rem" }}
            onClick={() => onStepChange(3)}
          >
            {t("ob.skipNow")}
          </button>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <h2 className="ob-h">{t("ob.firstTitle")}</h2>
          <p className="card-meta" style={{ marginBottom: "0.875rem" }}>
            {t("ob.firstBody")}
          </p>

          <p className="section-label" style={{ marginBottom: "0.5rem" }}>
            {t("ob.exHint")}
          </p>

          <div className="stack stack--tight">
            {EXAMPLES.map((e) => (
              <div className="ob-ex" key={e.id}>
                <span
                  className="tile__icon"
                  style={{ color: e.color, background: tint(e.color, TINT_SOFT) }}
                >
                  <Icon name={e.icon} size={19} />
                </span>
                <span className="ob-ex__body">
                  <span className="listrow__title">{t(e.nameKey)}</span>
                  <span className="ob-ex__label">{t(e.dateKey)}</span>
                </span>
                <input
                  className="ob-ex__date"
                  type="date"
                  aria-label={`${t(e.nameKey)} — ${t(e.dateKey)}`}
                  value={dates[e.id] ?? ""}
                  onChange={(ev) =>
                    setDates((d) => ({ ...d, [e.id]: ev.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="quick-grid" style={{ marginTop: "1rem" }}>
            <button className="btn btn--secondary" onClick={() => onStepChange(2)}>
              {t("ob.back")}
            </button>
            <button
              className="btn btn--primary"
              onClick={() => onStepChange(4)}
              disabled={!Object.values(dates).some(Boolean)}
            >
              {t("ob.continue")}
            </button>
          </div>

          <button
            className="btn btn--ghost btn--block"
            style={{ marginTop: "0.5rem" }}
            onClick={() => onStepChange(4)}
          >
            {t("ob.skipExplore")}
          </button>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <div className="ob-notif-ico" aria-hidden="true">
            <span
              className="tile__icon"
              style={{
                color: "var(--brand-700)",
                background: tint("var(--brand-700)", TINT_SOFT),
              }}
            >
              <Icon name="bell" size={26} />
            </span>
          </div>

          <h2 className="ob-h">{t("ob.notifTitle")}</h2>
          <p className="card-meta" style={{ marginBottom: "1rem" }}>
            {t("ob.notifBody")}
          </p>

          <button
            className="btn btn--primary btn--lg btn--block"
            onClick={() => void allowNotifications()}
          >
            {t("ob.allowNotif")}
            <Icon name="bell" size={18} />
          </button>

          <button
            className="btn btn--ghost btn--block"
            style={{ marginTop: "0.5rem" }}
            onClick={finish}
          >
            {t("ob.notNow")}
          </button>
        </>
      ) : null}
    </div>
  );
}

"use client";

/**
 * The mandatory introduction: three presentation-only screens shown on every
 * launch before the authentication welcome. It reads and writes no account or
 * device data; the language choice is the entry flow's own preference, and
 * completing the slides is handled by the caller (see lib/entryGate.ts).
 */

import { useId, useState } from "react";

import { BrandPanel } from "./BrandArt";
import { Icon, type IconName } from "./Icons";
import { Logo } from "./Logo";
import { LocalePicker } from "./Onboarding";
import type { Locale, Translate } from "@/lib/i18n";
import type { TKey } from "@/lib/locales/en";

interface Slide {
  readonly titleKey: TKey;
  readonly bodyKey: TKey;
  readonly art: "adire" | "chevron";
  readonly lead: IconName;
  readonly icons: readonly IconName[];
}

const SLIDES: readonly Slide[] = [
  {
    titleKey: "intro.welcomeTitle",
    bodyKey: "intro.welcomeBody",
    art: "adire",
    lead: "layers",
    icons: ["calendar", "checkCircle"],
  },
  {
    titleKey: "intro.organisedTitle",
    bodyKey: "intro.organisedBody",
    art: "chevron",
    lead: "receipt",
    icons: ["bell", "calendar", "car", "file"],
  },
  {
    titleKey: "intro.controlTitle",
    bodyKey: "intro.controlBody",
    art: "adire",
    lead: "shieldCheck",
    icons: ["lock", "cloudOff", "checkCircle"],
  },
];

export function Introduction({
  t,
  locale,
  onLocale,
  onComplete,
}: {
  t: Translate;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState(0);
  const titleId = useId();
  const slide = SLIDES[step];
  const last = step === SLIDES.length - 1;

  return (
    <main className="intro" aria-labelledby={titleId} lang={locale}>
      <div className="intro__col">
        <div className="intro__brand">
          <Logo variant="wordmark" priority />
        </div>

        <div className="intro__live" aria-live="polite" aria-atomic="true">
          <div className="intro__stage" key={step}>
            <BrandPanel variant={slide.art} height={200}>
              <div className="intro__art" aria-hidden="true">
                <span className="intro__art-main">
                  <Icon name={slide.lead} size={42} />
                </span>
                <span className="intro__chips">
                  {slide.icons.map((name) => (
                    <span className="intro__chip" key={name}>
                      <Icon name={name} size={20} />
                    </span>
                  ))}
                </span>
              </div>
            </BrandPanel>

            <h1 className="intro__title" id={titleId}>
              {t(slide.titleKey)}
            </h1>
            <p className="intro__body">{t(slide.bodyKey)}</p>
          </div>
        </div>

        {step === 0 ? (
          <div className="field" style={{ marginTop: "0.875rem" }}>
            <span>{t("ob.language")}</span>
            <LocalePicker locale={locale} onChange={onLocale} t={t} />
          </div>
        ) : null}

        <p className="sr-only">
          {t("intro.step", { current: step + 1, total: SLIDES.length })}
        </p>
        <div className="intro__dots ob-steps" role="presentation">
          {SLIDES.map((s, i) => (
            <span
              key={s.titleKey}
              className={i === step ? "ob-step ob-step--on" : "ob-step"}
            />
          ))}
        </div>

        <div className="intro__actions">
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={last ? onComplete : () => setStep(step + 1)}
          >
            {last ? t("intro.getStarted") : t("intro.continue")}
            <Icon name="arrowRight" size={18} />
          </button>
          {step > 0 ? (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => setStep(step - 1)}
            >
              {t("intro.back")}
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}

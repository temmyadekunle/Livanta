"use client";

/**
 * The first-time introduction: three presentation-only screens shown before
 * the authentication welcome. It reads and writes no account or device data;
 * completing it is handled by the caller, which writes the device-level
 * `livanta.intro.v1` marker.
 */

import { useId, useState } from "react";

import { BrandPanel } from "./BrandArt";
import { Icon, type IconName } from "./Icons";
import { Logo } from "./Logo";

interface Slide {
  readonly title: string;
  readonly body: string;
  readonly art: "adire" | "chevron";
  readonly lead: IconName;
  readonly icons: readonly IconName[];
}

const SLIDES: readonly Slide[] = [
  {
    title: "Welcome to Livanta",
    body: "Your personal life-management companion.",
    art: "adire",
    lead: "layers",
    icons: ["calendar", "checkCircle"],
  },
  {
    title: "Stay Organised",
    body: "Manage bills, reminders, important dates, vehicle schedules and documents.",
    art: "chevron",
    lead: "receipt",
    icons: ["bell", "calendar", "car", "file"],
  },
  {
    title: "Your Life, Under Control",
    body: "Simple, privacy-conscious and offline-first organisation.",
    art: "adire",
    lead: "shieldCheck",
    icons: ["lock", "cloudOff", "checkCircle"],
  },
];

export function Introduction({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const titleId = useId();
  const slide = SLIDES[step];
  const last = step === SLIDES.length - 1;

  return (
    <main className="intro" aria-labelledby={titleId}>
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
              {slide.title}
            </h1>
            <p className="intro__body">{slide.body}</p>
          </div>
        </div>

        <p className="sr-only">
          Step {step + 1} of {SLIDES.length}
        </p>
        <div className="intro__dots ob-steps" role="presentation">
          {SLIDES.map((s, i) => (
            <span
              key={s.title}
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
            {last ? "Get started" : "Continue"}
            <Icon name="arrowRight" size={18} />
          </button>
          {step > 0 ? (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}

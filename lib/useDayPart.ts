"use client";

import { useSyncExternalStore } from "react";

import { dayPart, type DayPart } from "./dates.ts";

/**
 * The current part of the day, kept live.
 *
 * The greeting needs to follow the clock, so reading `new Date()` during render
 * is not enough: a tab left open from lunchtime into the evening would keep
 * saying "Good afternoon" until something else happened to re-render it. This
 * subscribes instead, and the greeting corrects itself on its own.
 *
 * Two details keep it cheap and correct:
 *
 * - The snapshot is the *part*, not the time. Re-rendering every minute to
 *   discover the hour is the same as now would be pointless work; this only
 *   changes when the answer actually changes, three times a day.
 * - It also listens for focus and visibility. A phone that sleeps through the
 *   whole afternoon has no timer running, so returning to the tab is the one
 *   moment we are sure the cached answer is stale.
 *
 * The clock is the reader's own, which is what `dayPart` reads. Nothing here is
 * persisted or synced: what time it is where you are standing is not data about
 * you worth uploading.
 */

/** Roughly a minute: often enough that a boundary is never visibly late. */
const POLL_MS = 60_000;

function subscribeToClock(onChange: () => void): () => void {
  const timer = setInterval(onChange, POLL_MS);

  // A tab that was hidden has no reliable interval, so re-check the moment it
  // comes back rather than waiting out the remainder of a stale minute.
  const wake = () => {
    if (document.visibilityState === "visible") onChange();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
  };
}

function currentDayPart(): DayPart {
  return dayPart(new Date());
}

/* Used only for a prerendered build, where there is no clock to read. The
   greeting is not part of the app's server-rendered shell, so this exists to
   keep the hook's contract total rather than to be shown to anyone. */
function dayPartAtBuildTime(): DayPart {
  return "morning";
}

export function useDayPart(): DayPart {
  return useSyncExternalStore(subscribeToClock, currentDayPart, dayPartAtBuildTime);
}

/** The greeting key for a part of the day, for `t()`. */
export function greetingKey(part: DayPart): "app.greeting.morning" | "app.greeting.afternoon" | "app.greeting.evening" {
  return `app.greeting.${part}`;
}

/**
 * The first word of a saved display name, for the greeting. An empty name stays
 * empty so `greetingKeyFor` picks the nameless form rather than inventing one.
 */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * The greeting key that fits the reader: with a name when one is set, and the
 * nameless form otherwise. A profile from before names were captured, or one
 * the user deliberately cleared, still greets by the clock.
 */
export function greetingKeyFor(
  part: DayPart,
  name: string,
): "app.greeting.morning" | "app.greeting.afternoon" | "app.greeting.evening" | "app.greeting.morning.none" | "app.greeting.afternoon.none" | "app.greeting.evening.none" {
  return name.trim() ? greetingKey(part) : `app.greeting.${part}.none`;
}

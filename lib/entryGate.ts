/**
 * The entry flow's launch-scoped state.
 *
 * Two gates stand between a cold start and the app, and neither is persisted:
 * the introduction must be seen on every launch, and the authentication choice
 * must be made explicitly even when a session was restored. A module store
 * rather than component state because AppEntry and LivantaApp remount as the
 * auth status changes, and a remount must not send the user back to slide one.
 *
 * Nothing here touches an account or IndexedDB. The only device key is the
 * pre-auth language, which is a preference for these screens. When the user
 * picks a language, that choice also seeds the first-run onboarding, whose own
 * result is what saves the language to the account's settings.
 */

import { useCallback, useSyncExternalStore } from "react";

import { LOCALES, type Locale } from "./i18n.ts";

const ENTRY_LOCALE_KEY = "livanta.entry.locale.v1";

export interface EntryGateState {
  /** The introductory screens have been completed in this launch. */
  readonly introDone: boolean;
  /**
   * The user has authenticated in this launch, or explicitly continued an
   * already-valid session. A restored session alone never sets this.
   */
  readonly choiceDone: boolean;
  /** Language for the entry flow: introduction, welcome and first-run setup. */
  readonly locale: Locale;
}

let state: EntryGateState = { introDone: false, choiceDone: false, locale: "en" };
let localeHydrated = false;
const listeners = new Set<() => void>();

const getSnapshot = () => state;

function emit(patch: Partial<EntryGateState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * Reads the device's pre-auth language after hydration. The first render is
 * always English so the static export and the hydrated tree agree; a different
 * stored preference is applied in an effect rather than during render.
 */
export function hydrateEntryLocale(): void {
  if (localeHydrated) return;
  localeHydrated = true;
  if (typeof window === "undefined") return;
  try {
    const stored = window.localStorage.getItem(ENTRY_LOCALE_KEY);
    if (isLocale(stored) && stored !== state.locale) emit({ locale: stored });
  } catch {
    /* private browsing */
  }
}

/**
 * Whether this launch still has to pass the authentication choice.
 *
 * The reminder activation barrier consults this before it adopts an already
 * active plan: a restored session may be adopted, but its device notifications
 * must not stay armed behind the welcome screen. Reading the launch gate here
 * keeps that decision in one place; it is not account data.
 */
export function isEntryChoicePending(): boolean {
  return !state.choiceDone;
}

/** Resets the launch gates. Tests use this to simulate a cold start. */
export function resetEntryGateForTesting(patch: Partial<EntryGateState> = {}): void {
  state = { introDone: false, choiceDone: false, locale: "en", ...patch };
  localeHydrated = false;
  for (const listener of listeners) listener();
}

export function useEntryGate() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const completeIntroduction = useCallback(() => emit({ introDone: true }), []);
  const completeChoice = useCallback(() => emit({ choiceDone: true }), []);
  const setLocale = useCallback((locale: Locale) => {
    emit({ locale });
    try {
      window.localStorage.setItem(ENTRY_LOCALE_KEY, locale);
    } catch {
      /* the choice still applies to this launch */
    }
  }, []);

  return {
    ...current,
    completeIntroduction,
    completeChoice,
    setLocale,
  };
}

/**
 * The first-time introduction's device-level completion marker.
 *
 * The introduction is presentation-only: it must not open a database, read
 * settings or records, or seed anything. The only thing it leaves behind is
 * this non-secret localStorage key, which records completion and nothing else.
 * It is not account data and is never copied into an account database.
 *
 * An absent, corrupt or unreadable marker is treated as not completed, so the
 * introduction reappears rather than silently disappearing.
 */

import type { AuthStatus } from "./useAuth.ts";

export const INTRODUCTION_MARKER_KEY = "livanta.intro.v1";

interface ReadableStorage {
  getItem(key: string): string | null;
}

interface WritableStorage {
  setItem(key: string, value: string): void;
}

/** localStorage can throw on merely being read in some privacy modes. */
function deviceStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasCompletedIntroduction(
  storage: ReadableStorage | null = deviceStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(INTRODUCTION_MARKER_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Best effort by design: a device that refuses the write still advances to the
 * authentication screen for this launch, and the introduction simply appears
 * again next time.
 */
export function markIntroductionCompleted(
  storage: WritableStorage | null = deviceStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(INTRODUCTION_MARKER_KEY, "1");
  } catch {
    // Storage unavailable; treated as not completed on the next launch.
  }
}

export interface IntroductionGateInput {
  readonly authEnabled: boolean;
  readonly authStatus: AuthStatus;
  readonly completed: boolean;
}

/**
 * The introduction belongs to a signed-out device that has not seen it yet.
 * Loading, errors, a live session and an auth-disabled build keep their
 * existing surfaces; the introduction never becomes a fallback for them.
 */
export function shouldShowIntroduction(input: IntroductionGateInput): boolean {
  return input.authEnabled && input.authStatus === "signed-out" && !input.completed;
}

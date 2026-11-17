/**
 * Saves the optional profile details captured during account creation and
 * completes first-run setup for the new account.
 *
 * This is deliberately narrow: the caller must have already established that
 * Supabase created a new account and supplied its id. The write goes straight
 * to that user's account store, never the anonymous database, and only fills
 * fields that are still empty so a returning profile is never overwritten.
 * Setup is marked done because registration is the introduction the account
 * setup screens would otherwise repeat; the entry language is kept for a
 * first-run account but never imposed on one that already finished setup.
 */
import { isAvatarDataUrl } from "./avatar.ts";
import { createLocalStore, isValidUserId, userScope } from "./db.ts";
import type { Locale } from "./i18n.ts";
import { loadSettings, saveSettings } from "./settings.ts";

export interface RegistrationProfileInput {
  displayName?: string;
  avatar?: string;
  locale?: Locale;
}

/** True when nothing was left to write, or the write succeeded. */
export async function saveRegistrationProfile(
  userId: string,
  input: RegistrationProfileInput,
): Promise<boolean> {
  if (!isValidUserId(userId)) return false;

  const name = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const avatar = isAvatarDataUrl(input.avatar) ? input.avatar : "";
  try {
    const store = createLocalStore(userScope(userId));
    const current = await loadSettings(store);
    const firstRun = !current.onboarded;
    const next = {
      ...current,
      onboarded: true,
      displayName: current.displayName.trim() ? current.displayName : name,
      avatar: current.avatar ? current.avatar : avatar,
      locale: firstRun && input.locale ? input.locale : current.locale,
    };

    if (
      next.onboarded === current.onboarded &&
      next.displayName === current.displayName &&
      next.avatar === current.avatar &&
      next.locale === current.locale
    ) {
      return true;
    }
    await saveSettings(store, next);
    return true;
  } catch {
    return false;
  }
}

import { anonymousStore, type LocalStore } from "./db.ts";
import { isAvatarDataUrl } from "./avatar.ts";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./i18n.ts";
import type { Category } from "./types.ts";

export interface Settings {
  onboarded: boolean;
  displayName: string;
  /**
   * Profile picture as a small data URL, or "" for none.
   *
   * A string rather than a Blob because this is one field of a record that is
   * already JSON and already synced: a Blob would need a second store, a second
   * sync path, and would not survive the export/import round trip. `readAvatar`
   * keeps it to tens of kilobytes. Treat anything read back as untrusted and
   * check it with `isAvatarDataUrl` before rendering.
   */
  avatar: string;
  /** UI language. */
  locale: Locale;
  /** Low-data mode: suppress anything that would upload or download. */
  dataSaver: boolean;
  /** Fire a browser notification when urgent alerts exist. */
  notifyUrgent: boolean;
  /** Days ahead of the due date that a reminder should appear. */
  leadDays: number[];
  /** Which areas the user said they want to manage during onboarding. */
  managedCategories: Category[];
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  displayName: "",
  avatar: "",
  locale: DEFAULT_LOCALE,
  dataSaver: true,
  notifyUrgent: true,
  leadDays: [90, 30, 7],
  managedCategories: [],
};

const KEY = "settings";

// The no-store overload preserves legacy calls; explicit stores never fall back.
export function loadSettings(): Promise<Settings>;
export function loadSettings(store: LocalStore): Promise<Settings>;
export async function loadSettings(...args: [] | [store: LocalStore]): Promise<Settings> {
  const store = args.length === 0 ? anonymousStore : args[0];
  try {
      const stored = await store.getSetting<Partial<Settings>>(KEY);
      const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
      if (!isLocale(merged.locale)) merged.locale = DEFAULT_LOCALE;
      // Settings can be restored from an export, arrive by sync, or predate this
      // field entirely. Anything that is not a small image data URL is not a
      // picture, so drop it here rather than handing a broken value to <img>.
      if (!isAvatarDataUrl(merged.avatar)) merged.avatar = "";
      return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// Only the legacy one-argument call selects anonymous storage.
export function saveSettings(settings: Settings): Promise<void>;
export function saveSettings(store: LocalStore, settings: Settings): Promise<void>;
export async function saveSettings(
  ...args: [settings: Settings] | [store: LocalStore, settings: Settings]
): Promise<void> {
  const [store, settings] = args.length === 1 ? [anonymousStore, args[0]] : args;
  await store.putSetting(KEY, settings);
}
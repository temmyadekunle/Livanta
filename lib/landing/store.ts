/**
 * Store configuration for the landing page.
 *
 * Both URLs are empty right now, and that is the honest state: Livanta has not
 * been submitted to either store. Every download control reads from here and
 * renders a disabled "Coming soon" state when a URL is missing, so there is no
 * path in the code that can navigate a visitor to a listing that does not exist.
 *
 * When a store listing exists, set the value and nothing else needs to change:
 * the badges become live links, the QR code starts pointing at the real
 * destination, and the sticky mobile CTA opens the right store for the platform.
 *
 * Do not put a plausible-looking URL in here to make the page look finished.
 * A dead store link is worse than an honest "coming soon", because the visitor
 * only discovers it after tapping.
 */

/** Google Play listing. Empty until the app is published. */
export const GOOGLE_PLAY_URL = "";

/** Apple App Store listing. Empty until the app is published. */
export const APPLE_APP_STORE_URL = "";

/**
 * Direct Android APK, published as a GitHub release. Verified live on
 * 2026-10-16: HTTP 200, Content-Type application/vnd.android.package-archive,
 * 7,030,891 bytes (v0.1.1, versionCode 5, adds local notification reminders).
 * This is a sideload build, not a store listing, so it lives beside the
 * (still empty) store URLs rather than inside them. iOS devices cannot
 * install it; the download controls only surface it where it works.
 */
export const DIRECT_APK_URL =
  "https://github.com/temmyadekunle/Livanta/releases/download/v0.1.1/livanta-0.1.1-release.apk";
/** Version label shown next to the APK link. Bump with each release upload. */
export const APK_VERSION = "0.1.1";
export const APK_SIZE_BYTES = 7_032_943;

/** Formats the APK size the way a download page should ("6.7 MB"). */
export function apkSizeLabel(bytes: number = APK_SIZE_BYTES): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * Where the QR code and the generic desktop CTA point once publishing happens.
 * This is the one URL a person on a desktop computer can act on, since a
 * desktop cannot install from a store that has no desktop build. Deliberately
 * empty for now: an unresolvable QR code is a dead end with extra steps.
 */
export const APP_DOWNLOAD_PAGE_URL = "";

export type StoreId = "google-play" | "app-store";

export interface Store {
  id: StoreId;
  /** Short name for tight spaces and screen readers. */
  name: string;
  /** Full platform name, used in prose. */
  platform: string;
  url: string;
  available: boolean;
  /** Shown on the badge when there is no listing yet. */
  unavailableLabel: string;
}

export const STORES: Record<StoreId, Store> = {
  "google-play": {
    id: "google-play",
    name: "Google Play",
    platform: "Android",
    url: GOOGLE_PLAY_URL,
    available: GOOGLE_PLAY_URL.length > 0,
    unavailableLabel: "Coming soon to Google Play",
  },
  "app-store": {
    id: "app-store",
    name: "App Store",
    platform: "iPhone",
    url: APPLE_APP_STORE_URL,
    available: APPLE_APP_STORE_URL.length > 0,
    unavailableLabel: "Coming soon to the App Store",
  },
};

export const STORE_LIST: Store[] = [STORES["google-play"], STORES["app-store"]];

/** True once any download destination is real. Gates the QR code and sticky CTA. */
export const ANY_STORE_AVAILABLE = STORE_LIST.some((s) => s.available);

/**
 * The store a device should be sent to, or null when it cannot be determined
 * or nothing is published yet.
 *
 * Order matters: an iPad reports a Macintosh user agent and an Android tablet
 * can report a desktop one, so the touch-point check has to come before the
 * platform string is trusted.
 */
export function storeForDevice(
  userAgent: string | undefined,
  maxTouchPoints = 0,
): Store | null {
  if (!ANY_STORE_AVAILABLE) return null;
  if (!userAgent) return null;

  const ua = userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (iOS) return STORES["app-store"].available ? STORES["app-store"] : null;

  if (/Android/i.test(ua)) {
    return STORES["google-play"].available ? STORES["google-play"] : null;
  }

  // A desktop has no store build to open, so it gets the download page instead.
  return null;
}

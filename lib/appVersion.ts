/**
 * Single source of truth for the released version and Android artifact.
 *
 * `package.json`, `package-lock.json` and `android/app/build.gradle` carry the
 * same pair. `tests/version.test.ts` fails if any of them drifts, and
 * `build-android.ps1` refuses to build when the Gradle metadata and
 * `package.json` disagree. Bump all three together for a new release, and
 * always increment the Android version code.
 */

export const APP_VERSION = "0.1.1";

/** Android version code shipped with 0.1.1. New releases must exceed it. */
export const ANDROID_VERSION_CODE = 5;

const RELEASE_BASE_URL =
  "https://github.com/temmyadekunle/Livanta/releases/download";

export const APK_FILE_NAME = `livanta-${APP_VERSION}-release.apk`;

/**
 * Direct sideload build. Verified live on 2026-11-13: HTTP 200,
 * `application/vnd.android.package-archive`, matching the file in
 * `output/android`. This is not a store listing, so it is kept separate from
 * the still-empty store URLs in `lib/landing/store.ts`.
 */
export const DIRECT_APK_URL = `${RELEASE_BASE_URL}/v${APP_VERSION}/${APK_FILE_NAME}`;

/** Bytes of `output/android/livanta-0.1.1-release.apk` (7.0 MB decimal). */
export const APK_SIZE_BYTES = 7_032_943;

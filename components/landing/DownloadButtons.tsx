"use client";

/**
 * Download controls for the closing section.
 *
 * Both real actions are ordinary links, rendered on the server as well as in
 * the browser: the web app at `/`, and the Android APK published as a GitHub
 * release. Nothing here depends on device detection, so the static export
 * always contains the version, the size and a working destination even with
 * JavaScript disabled. The iPhone note exists because the APK cannot be
 * installed there, not because the link is hidden.
 *
 * Google Play and the App Store are shown as plain status cards — not buttons,
 * not imitations of the official store badges. They stay inert until
 * `lib/landing/store.ts` holds a real listing URL, so a visitor is never sent
 * to a search that finds nothing.
 */
import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Icon } from "@/components/Icons";
import {
  APP_VERSION,
  DIRECT_APK_URL,
  apkSizeLabel,
  STORES,
  storeForDevice,
  type Store,
} from "@/lib/landing/store";

const subscribeToNothing = () => () => {};

/* Official artwork from the store owners' own asset hosts, served locally so
   the static export and CSP keep working without a third-party request:
   - Google Play: gstatic.com product icon, play_store_64dp@2x
   - App Store: developer.apple.com app-store-96x96@2x
   The icons are decorative; the store name carries the accessible label. */
const STORE_LOGOS: Record<Store["id"], string> = {
  "google-play": "/stores/google-play.png",
  "app-store": "/stores/app-store.png",
};

/**
 * A store that is not live yet. Deliberately inert: no anchor and no hover
 * state. The logo identifies the store; "Coming Soon" states availability.
 */
function StoreStatus({ store }: { store: Store }) {
  return (
    <div className="lp-store-status">
      <span className="lp-store-status__brand">
        <Image
          className="lp-store-status__logo"
          src={STORE_LOGOS[store.id]}
          alt=""
          width={32}
          height={32}
        />
        <span className="lp-store-status__name">{store.name}</span>
      </span>
      <span className="lp-store-status__state">Coming Soon</span>
    </div>
  );
}

/**
 * The closing download section: the web app, the APK, two store status cards,
 * and the iPhone guidance for people who cannot use an APK.
 */
export function DownloadSection() {
  return (
    <div className="lp-download">
      <Link className="lp-download__button lp-download__button--ghost" href="/">
        <Icon name="globe" size={20} />
        <span className="lp-download__text">
          <span className="lp-download__title">Open the web app</span>
          <span className="lp-download__meta">
            Any modern browser · sign-in required
          </span>
        </span>
      </Link>

      <a
        className="lp-download__button"
        href={DIRECT_APK_URL}
        rel="noopener noreferrer"
        download
      >
        <Icon name="download" size={20} />
        <span className="lp-download__text">
          <span className="lp-download__title">Download for Android</span>
          <span className="lp-download__meta">
            APK · v{APP_VERSION} · {apkSizeLabel()}
          </span>
        </span>
      </a>

      <div className="lp-download__stores">
        <StoreStatus store={STORES["google-play"]} />
        <StoreStatus store={STORES["app-store"]} />
      </div>

      <p className="lp-download__note">
        The Google Play and App Store listings are not live yet.
      </p>

      <noscript>
        <p className="lp-download__note">
          JavaScript is off, but both buttons above are ordinary links: one
          opens the web app, the other downloads the APK.
        </p>
      </noscript>

      <p className="lp-download__ios">
        <strong>On iPhone or iPad?</strong> Use the web app. The Android APK
        cannot be installed there, so open Livanta in Safari, tap{" "}
        <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.
      </p>
    </div>
  );
}

/* Which store a device wants is a fact about the browser, not about anything
   React is managing, and it cannot change while the page is open. So there is
   no event to subscribe to: the only thing React needs is a way to read the
   server's answer (nothing, it has no navigator) and this browser's answer.

   Reading it this way also means no `useState` in an effect, which would paint
   a "Coming soon" bar and then repaint it a moment later the moment a store
   does exist. */
const noStoreOnServer = () => null;
const storeOnThisDevice = (): Store | null =>
  storeForDevice(navigator.userAgent, navigator.maxTouchPoints);
const androidOnThisDevice = (): boolean =>
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export function StickyCta() {
  const store = useSyncExternalStore(
    subscribeToNothing,
    storeOnThisDevice,
    noStoreOnServer,
  );
  const isAndroid = useSyncExternalStore(
    subscribeToNothing,
    androidOnThisDevice,
    () => false,
  );

  // Before publication Android phones scroll to the one APK action instead of
  // repeating it. A second download button in a fixed bar is both a duplicate
  // and easy to hit by accident.
  const apkFallback = !store && isAndroid;

  // Nothing this device can act on, so the bar stays out of the way entirely
  // rather than parking a dead button over the bottom of every page.
  if (!store && !apkFallback) return null;

  return (
    <div className="lp-sticky">
      <div className="lp-sticky__inner">
        <span className="lp-sticky__text">
          <strong>Livanta</strong>
          <span>
            {store
              ? `Get it on ${store.name}`
              : `Android APK · v${APP_VERSION}`}
          </span>
        </span>
        {store ? (
          <a
            className="btn btn--primary btn--sm"
            href={store.url}
            rel="noopener noreferrer"
          >
            Download
          </a>
        ) : (
          <a className="btn btn--primary btn--sm" href="#download">
            Get the app
          </a>
        )}
      </div>
    </div>
  );
}

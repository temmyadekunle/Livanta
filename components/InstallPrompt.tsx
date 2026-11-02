"use client";

/**
 * PWA install prompt and update notice.
 *
 * Android and desktop Chrome fire `beforeinstallprompt`, which lets the app ask
 * to be installed. iOS never fires that event: there is no programmatic
 * install API on Safari, and the only route is Add to Home Screen from the
 * share sheet. So this component offers a real button where the browser allows
 * one, and falls back to short instructions where it does not, rather than
 * showing a dead control.
 *
 * iOS is detected by capability, not by user agent, where possible. Both are
 * checked because neither signal alone is reliable: Safari on iPad reports a
 * Macintosh user agent, and a desktop browser can spoof the platform string.
 */
import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icons";
import {
  activateWaitingWorker,
  isSupported,
  registerServiceWorker,
  type SwUpdateState,
} from "@/lib/serviceWorker";

/** iPadOS reports as Macintosh, so the touch-point count is the real tell. */
function detectPlatform() {
  if (typeof navigator === "undefined")
    return { ios: false, safari: false, android: false };
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ masquerades as desktop Safari.
    (/Macintosh/.test(ua) && Number(navigator.maxTouchPoints ?? 0) > 1);
  const safari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
  const android = /android/i.test(ua);
  return { ios, safari, android };
}

const ANDROID_APK_URL =
  "https://github.com/temmyadekunle/Livanta/releases/download/v0.1.1/livanta-0.1.1-release.apk";

/**
 * Whether the app is already running as an installed app. Read lazily rather
 * than during render so it is not baked into the server-rendered HTML, which
 * would suppress the install prompt for the very first load on a real install.
 */
function isRunningStandalone() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
  // iOS Safari has no display-mode support and only this legacy property.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * The shape of beforeinstallprompt. Typed here rather than casting inline
 * because the two members used are exactly what distinguishes a real event
 * from a plain one.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Lazy initialiser rather than an effect that sets it. On the server this
  // evaluates to false, so the install bar is absent from the rendered HTML and
  // cannot flash before hydration; on the client it is correct from the first
  // paint. Setting it from an effect instead would render `false` first and then
  // flip, which shows the bar and hides it again on every load for an installed
  // app.
  const [installed, setInstalled] = useState(isRunningStandalone);
  const [swState, setSwState] = useState<SwUpdateState>("none");
  const { ios, safari, android } = detectPlatform();

  useEffect(() => {
    const clean = registerServiceWorker({
      onUpdate: setSwState,
      onError: () => setSwState("none"),
    });
    return clean;
  }, []);

  useEffect(() => {
    // Fired only when the app is installable and not already installed. The
    // event must be captured with preventDefault() or Chrome discards it and
    // prompt() will never fire.
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) {
      setShowIosHelp(true);
      return;
    }
    await deferred.prompt();
    // The choice the user made has to be read, or the event can only be used
    // once per page load and the prompt may reappear against their wishes.
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
  }, [deferred]);

  // An available update is worth interrupting for: the user is looking at an
  // older shell than the one deployed.
  if (swState === "installed") {
    return (
      <div className="installbar" role="status">
        <Icon name="sparkles" />
        <span>A new version is ready.</span>
        <button
          type="button"
          className="installbar__btn"
          onClick={() => {
            activateWaitingWorker();
            setSwState("activated");
            window.location.reload();
          }}
        >
          Update now
        </button>
      </div>
    );
  }

  if (installed || dismissed) return null;

  if (android) {
    return (
      <div className="installbar" role="region" aria-label="Get Livanta for Android">
        <Icon name="download" />
        <span className="installbar__text">Get the Livanta app for Android</span>
        <a className="installbar__btn" href={ANDROID_APK_URL}>
          Download APK
        </a>
        <button
          type="button"
          className="installbar__close"
          aria-label="Dismiss install prompt"
          onClick={() => setDismissed(true)}
        >
          <Icon name="x" />
        </button>
      </div>
    );
  }

  if (!deferred && !(ios && safari)) return null;

  return (
    <div className="installbar" role="region" aria-label="Install Livanta">
      <Icon name="download" />
      <span className="installbar__text">
        {deferred ? "Install Livanta for quick access" : "Add Livanta to your Home Screen"}
      </span>

      {showIosHelp || !deferred ? (
        <span className="installbar__help">
          Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>
        </span>
      ) : (
        <button
          type="button"
          className="installbar__btn"
          onClick={() => void promptInstall()}
        >
          Install
        </button>
      )}

      <button
        type="button"
        className="installbar__close"
        aria-label="Dismiss install prompt"
        onClick={() => setDismissed(true)}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

/** Re-exported for tests so the supported check is asserted directly. */
export { isSupported as serviceWorkerSupported };

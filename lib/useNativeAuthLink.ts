/**
 * Handles Android App Links for both emailed link styles.
 *
 * A token-hash link is exchanged in place with `verifyOtp`, so the token never
 * becomes a WebView navigation and no reload is needed. The older implicit
 * link is reduced to its fragment and placed on the app root before reloading,
 * which lets supabase-js and the existing notice handle it unchanged.
 *
 * The native side reports the launch intent more than once, and a WebView
 * reload can report it again. `nativeAuthLinkRouter` owns those one-shot rules;
 * this hook only attaches the Capacitor listener and supplies the side effects.
 */

import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import { nativeAuthLinkDestination } from "./nativeAuthLink.ts";
import { createNativeAuthLinkRouter } from "./nativeAuthLinkRouter.ts";
import { isCloudEnabled } from "./supabase/client.ts";
import {
  reportEmailLinkFailure,
  verifyEmailLinkToken,
} from "./useAuth.ts";

function applyLink(fragment: string): boolean {
  try {
    window.history.replaceState(
      null,
      "",
      nativeAuthLinkDestination(fragment),
    );
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function useNativeAuthLink(): void {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!isCloudEnabled()) return;

    let active = true;
    const router = createNativeAuthLinkRouter({
      verify: verifyEmailLinkToken,
      reportInvalid: () => reportEmailLinkFailure("invalid"),
      replay: applyLink,
      storage: sessionStorageOrNull(),
    });

    let handle: { remove: () => Promise<void> } | undefined;
    void App.addListener("appUrlOpen", (event) => {
      if (!active) return;
      void router.handle(event.url, false);
    }).then((h) => {
      if (active) handle = h;
      else void h.remove();
    });

    // After a legacy replay the native side still reports the same launch
    // intent, so only a cold launch without that flag may read it.
    if (router.launchAvailable) {
      void App.getLaunchUrl()
        .then((launch) => {
          if (!active) return;
          void router.handle(launch?.url, true);
        })
        .catch(() => {
          /* No launch URL is an ordinary icon launch. */
        });
    }

    return () => {
      active = false;
      void handle?.remove();
    };
  }, []);
}

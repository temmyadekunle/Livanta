/**
 * Decides what one native App Link event does, at launch or while running.
 *
 * The event source repeats itself: Android retains the launch intent and
 * Capacitor reports it both through `getLaunchUrl` and the initial
 * `appUrlOpen`, and an Activity can deliver the same link again. This module
 * owns the one-shot and duplicate rules so the hook stays a thin listener.
 *
 * It never stores a token. Session storage holds only booleans: one that keeps
 * the older implicit replay from looping across its own reload, and one that
 * keeps a consumed token-hash launch from being verified again after a WebView
 * reload. Both are best effort; a storage failure disables launch replay, but
 * a token hash is still verified because that path does not reload.
 */

import type { TokenHashLink } from "./authTokenHash.ts";
import {
  isNativeAuthConfirmLink,
  nativeAuthLinkFragment,
  nativeTokenHashLink,
} from "./nativeAuthLink.ts";

export type NativeAuthLinkAction =
  | "verified"
  | "replayed"
  | "invalid"
  | "ignored"
  | "busy"
  | "failed";

export interface NativeAuthLinkRouterOptions {
  /** Exchanges a validated token hash; resolve or reject, never expose it. */
  readonly verify: (link: TokenHashLink) => Promise<unknown>;
  /** Shows the ordinary invalid-link explanation. */
  readonly reportInvalid: () => void;
  /** Replays an accepted implicit/error fragment onto the app root. */
  readonly replay: (fragment: string) => boolean;
  readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  readonly publishedOrigin?: string;
}

export interface NativeAuthLinkRouter {
  /** False when a previous reload already consumed this launch's replay. */
  readonly launchAvailable: boolean;
  handle(
    raw: string | null | undefined,
    fromLaunch: boolean,
  ): Promise<NativeAuthLinkAction>;
}

const REPLAYED_KEY = "livanta.nativeAuthLink.replayed";
const TOKEN_HANDLED_KEY = "livanta.nativeTokenLink.handled";

export function createNativeAuthLinkRouter(
  options: NativeAuthLinkRouterOptions,
): NativeAuthLinkRouter {
  const storage = options.storage ?? null;
  let storageOk = storage !== null;
  let replayed = false;
  let suppressLaunchToken = false;

  try {
    if (storage?.getItem(REPLAYED_KEY) !== null && storage !== null) {
      storage.removeItem(REPLAYED_KEY);
      replayed = true;
    }
    if (storage?.getItem(TOKEN_HANDLED_KEY) !== null && storage !== null) {
      storage.removeItem(TOKEN_HANDLED_KEY);
      suppressLaunchToken = true;
    }
  } catch {
    storageOk = false;
  }

  let applied = false;
  let verifying = false;
  let lastToken: string | null = null;
  let lastInvalid: string | null = null;

  const remember = (key: string) => {
    if (!storageOk || !storage) return;
    try {
      storage.setItem(key, "1");
    } catch {
      /* the flag is an optimisation, not a credential */
    }
  };

  const forget = (key: string) => {
    if (!storageOk || !storage) return;
    try {
      storage.removeItem(key);
    } catch {
      /* the page is not reloading, so a stale flag is harmless */
    }
  };

  async function handle(
    raw: string | null | undefined,
    fromLaunch: boolean,
  ): Promise<NativeAuthLinkAction> {
    const token = nativeTokenHashLink(raw, options.publishedOrigin);
    if (token) {
      if (fromLaunch && suppressLaunchToken) return "ignored";
      const key = `${token.type}:${token.tokenHash}`;
      if (verifying) return "busy";
      if (lastToken === key) return "ignored";
      lastToken = key;
      if (fromLaunch) remember(TOKEN_HANDLED_KEY);
      verifying = true;
      try {
        await options.verify(token);
        return "verified";
      } catch {
        // The verifier reports its own failure state; this only stops an
        // unhandled rejection from a plugin callback.
        return "failed";
      } finally {
        verifying = false;
      }
    }

    const fragment = nativeAuthLinkFragment(raw, options.publishedOrigin);
    if (!fragment) {
      if (!isNativeAuthConfirmLink(raw, options.publishedOrigin)) {
        return "ignored";
      }
      // The link is on the app's confirmation path but has nothing usable.
      // Do not let it pass as an ordinary launch with no explanation.
      if (fromLaunch && suppressLaunchToken) return "ignored";
      if (verifying) return "busy";
      if (lastInvalid === raw) return "ignored";
      lastInvalid = raw ?? null;
      options.reportInvalid();
      return "invalid";
    }

    if (applied) return "ignored";
    if (fromLaunch && (replayed || !storageOk)) return "ignored";
    if (storageOk) remember(REPLAYED_KEY);
    applied = options.replay(fragment);
    if (!applied) forget(REPLAYED_KEY);
    return applied ? "replayed" : "ignored";
  }

  return {
    launchAvailable: !replayed,
    handle,
  };
}

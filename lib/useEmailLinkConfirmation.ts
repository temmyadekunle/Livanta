"use client";

/**
 * The web half of the emailed token-hash flow, run by `/auth/confirm/`.
 *
 * The URL is read once, before supabase-js is allowed to touch it: a token
 * hash is stripped and exchanged with `verifyOtp`; an implicit fragment is
 * moved to the app root untouched for the legacy exchange; an empty or broken
 * link gets an explanation. The hook returns only a phase and a translated
 * reason, never the token.
 *
 * The state lives in a tiny external store rather than in effect-driven
 * setState. That keeps the first client render identical to the prerendered
 * one, and the effect is only a handover to the URL and the network.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import type { AuthLinkError } from "./authLinkError.ts";
import {
  appRootWithFragment,
  hasImplicitOrErrorFragment,
  parseTokenHashLink,
  stripSensitiveAuthParams,
} from "./authTokenHash.ts";
import { verifyEmailLinkToken } from "./useAuth.ts";

export type EmailLinkConfirmPhase = "checking" | "ready" | "failed";

interface ConfirmState {
  readonly phase: EmailLinkConfirmPhase;
  readonly error: AuthLinkError | null;
}

const CHECKING: ConfirmState = { phase: "checking", error: null };

interface ConfirmStore {
  state: ConfirmState;
  readonly listeners: Set<() => void>;
}

export interface EmailLinkConfirmation {
  readonly phase: EmailLinkConfirmPhase;
  readonly error: AuthLinkError | null;
  /** Leaves the failure page for the app root, keeping the entry gate intact. */
  readonly back: () => void;
}

function replaceUrl(path: string): void {
  try {
    window.history.replaceState(null, "", path);
  } catch {
    /* the state still reflects what was read; only the address bar lags */
  }
}

/**
 * A link that mentions a token hash anywhere is either valid or broken; it is
 * never the legacy implicit flow. Without this check a fragment carrying both
 * `token_hash` and `access_token` would skip the token exchange and bootstrap
 * a session straight from the address bar.
 */
function mentionsTokenHash(url: URL): boolean {
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  return url.searchParams.has("token_hash") || fragment.has("token_hash");
}

export function useEmailLinkConfirmation(): EmailLinkConfirmation {
  // The store is an external system from React's point of view: the effect
  // writes it and subscribers are notified, so the first render is the same
  // whether it runs on the server or after hydration.
  const store = useRef<ConfirmStore>({
    state: CHECKING,
    listeners: new Set(),
  }).current;

  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    [store],
  );

  const getSnapshot = useCallback(() => store.state, [store]);
  const getServerSnapshot = useCallback(() => CHECKING, []);
  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const update = useCallback(
    (next: ConfirmState) => {
      store.state = next;
      for (const listener of store.listeners) listener();
    },
    [store],
  );

  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const url = new URL(window.location.href);
    const link = parseTokenHashLink(url);
    const cleaned = stripSensitiveAuthParams(url);
    if (link) {
      replaceUrl(`${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
      // The store outlives React's development double-invoke and a late
      // unmount, so the exchange result is kept rather than dropped when the
      // effect is re-run. The once-guard above still prevents a second call.
      void verifyEmailLinkToken(link).then((outcome) => {
        if (outcome.ok) {
          replaceUrl("/");
          update({ phase: "ready", error: null });
        } else {
          update({ phase: "failed", error: outcome.error });
        }
      });
      return;
    }

    // A project still on Supabase's default template redirects here with an
    // implicit fragment. Hand it to the root so the existing exchange, the
    // confirmation proof and the failure notice all keep working. A broken
    // token-hash link is refused above and never reaches this fallback.
    if (!mentionsTokenHash(url) && hasImplicitOrErrorFragment(url.hash)) {
      replaceUrl(appRootWithFragment(url.hash));
      update({ phase: "ready", error: null });
      return;
    }

    replaceUrl(`${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
    update({ phase: "failed", error: "invalid" });
  }, [update]);

  const back = useCallback(() => {
    replaceUrl("/");
    update({ phase: "ready", error: state.error });
  }, [state.error, update]);

  return { phase: state.phase, error: state.error, back };
}

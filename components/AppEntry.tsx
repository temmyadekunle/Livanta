"use client";

/**
 * Chooses between the first-time introduction and the existing app before
 * either surface mounts. Keeping this above LivantaApp matters: the
 * introduction is presentation-only and must not open the anonymous database
 * or read settings, which mounting the app would do.
 *
 * The introduction is only for a signed-out, auth-enabled device that has not
 * completed it. Loading and error states keep the app's own fail-closed
 * surfaces, and a signed-in or auth-disabled build goes straight to the app.
 */

import { useEffect, useSyncExternalStore } from "react";

import LivantaApp from "./LivantaApp";
import { Introduction } from "./Introduction";
import { Logo } from "./Logo";
import { getAccountTransitionCoordinator } from "@/lib/accountTransition";
import {
  hasCompletedIntroduction,
  markIntroductionCompleted,
  shouldShowIntroduction,
} from "@/lib/introduction";
import { registerSessionTeardown, useAuth } from "@/lib/useAuth";

/**
 * "unread" exists only for the server snapshot. The marker lives in
 * localStorage, which the server cannot read, so the first frame is a neutral
 * splash rather than a guess that would either flash the introduction for a
 * returning user or hide it from a new one.
 */
type IntroState = "unread" | "pending" | "complete";

const introListeners = new Set<() => void>();

function subscribeToIntro(listener: () => void) {
  introListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    introListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readIntroState(): IntroState {
  return hasCompletedIntroduction() ? "complete" : "pending";
}

function serverIntroState(): IntroState {
  return "unread";
}

function completeIntroduction() {
  markIntroductionCompleted();
  for (const listener of introListeners) listener();
}

function StartSplash() {
  return (
    <div className="intro">
      <div className="intro__col splash" role="status" aria-live="polite">
        <span className="splash__logo">
          <Logo variant="wordmark" priority />
        </span>
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}

export default function AppEntry() {
  const auth = useAuth();
  const intro = useSyncExternalStore(
    subscribeToIntro,
    readIntroState,
    serverIntroState,
  );

  /* The transition coordinator lives outside React because LivantaApp is
     remounted whenever the auth status changes. A coordinator created inside
     it would die at exactly the moment a transition starts, leaving the ended
     session's reminders and store with no owner. Registering its teardown here
     also gives useAuth something to run for a session Supabase ends on its own
     (expiry, or another tab signing out), where there is no call-site callback.
     This component itself is not keyed, so the registration survives the
     remount. */
  const coordinator = getAccountTransitionCoordinator();
  useEffect(() => {
    registerSessionTeardown(() => coordinator.signOut("sign-out"));
    return () => registerSessionTeardown(null);
  }, [coordinator]);

  /* A first-time device waits for the session check before showing the
     introduction, so an existing session is never interrupted by it. */
  if (intro === "unread" || (intro === "pending" && auth.enabled && auth.status === "loading")) {
    return <StartSplash />;
  }

  if (
    shouldShowIntroduction({
      authEnabled: auth.enabled,
      authStatus: auth.status,
      completed: intro === "complete",
    })
  ) {
    return <Introduction onComplete={completeIntroduction} />;
  }

  /* Remounting on a different account is what guarantees no view state from
     the previous session (open sheet, editor, confirmation, tab, onboarding
     step) can reappear over the new one. Persistent records are untouched:
     only this component's state is discarded. */
  const accountKey =
    auth.status === "signed-in" ? `user:${auth.user?.id ?? ""}` : auth.status;

  return <LivantaApp key={accountKey} coordinator={coordinator} />;
}

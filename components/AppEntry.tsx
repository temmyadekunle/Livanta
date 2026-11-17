"use client";

/**
 * Runs the mandatory entry flow before the app mounts.
 *
 * Every launch starts with the introduction, whatever the session state: a
 * restored session must not skip the introduction or the authentication
 * choice. The one exception is a session exchanged from this launch's own
 * sign-up confirmation link, which is itself proof of the account. Keeping
 * this above LivantaApp also means the introduction cannot open an account
 * store or read settings; it ends by handing over to the app, whose own
 * surface decision then requires an authenticated session.
 *
 * Auth-disabled builds keep their existing offline onboarding flow.
 */

import { useEffect, useState } from "react";

import LivantaApp from "./LivantaApp";
import { Introduction } from "./Introduction";
import { getAccountTransitionCoordinator } from "@/lib/accountTransition";
import { parseConfirmationLinkAccessToken } from "@/lib/authLinkError";
import { hydrateEntryLocale, useEntryGate } from "@/lib/entryGate";
import { makeT } from "@/lib/i18n";
import { shouldShowIntroduction } from "@/lib/introduction";
import { registerSessionTeardown, useAuth } from "@/lib/useAuth";

export default function AppEntry() {
  const auth = useAuth();
  const gate = useEntryGate();

  /* Read once, before useAuth starts and supabase-js consumes the fragment.
     It only decides whether to hold the introduction back while the client
     exchanges the link; the session itself is what proves the confirmation. */
  const [linkPending] = useState(() => {
    if (!auth.enabled || typeof window === "undefined") return false;
    return parseConfirmationLinkAccessToken(window.location.hash) !== null;
  });

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

  useEffect(() => {
    hydrateEntryLocale();
  }, []);

  /* A session exchanged from this launch's sign-up confirmation is proof of the
     account, exactly as a recovery link is. The introduction and the explicit
     "Continue as" choice exist to make a *restored* session earn that proof;
     asking again here would leave two screens between a confirmed user and
     their desk. The flag is only set when the published session's token is the
     one the link carried, so a restored session, a failed exchange or another
     account keeps both gates. */
  const linkedLaunch = auth.enabled && auth.emailLinkAuthenticated;
  const { completeIntroduction, completeChoice } = gate;
  useEffect(() => {
    if (!linkedLaunch) return;
    completeIntroduction();
    completeChoice();
  }, [linkedLaunch, completeIntroduction, completeChoice]);

  /* The fragment is visible a moment before the client finishes exchanging it.
     Holding the introduction until the session settles stops it flashing for
     a user who is about to land on the desk. A link that fails to exchange
     settles into the ordinary flow on the next render. Implicit links arrived
     through the native bridge already reload this page with the fragment, so
     there is nothing to wait for here. */
  if (linkPending && auth.status === "loading") return null;

  /* A token-hash link is verified in place on Android, so there may be a
     restored account, an armed reminder plan, or the introduction underneath
     while `verifyOtp` is in flight. Holding every surface until it settles
     means none of those can be mistaken for the link's result. */
  if (auth.emailLinkVerifying) return null;

  /* A broken token link still deserves its explanation straight away. Skipping
     the introduction is presentation only: the welcome choice remains, since
     an invalid link is never proof of an account. */
  if (
    shouldShowIntroduction({ authEnabled: auth.enabled }) &&
    !gate.introDone &&
    !linkedLaunch &&
    !auth.emailLinkAttempted
  ) {
    return (
      <Introduction
        t={makeT(gate.locale)}
        locale={gate.locale}
        onLocale={gate.setLocale}
        onComplete={gate.completeIntroduction}
      />
    );
  }

  /* Remounting on a different account is what guarantees no view state from
     the previous session (open sheet, editor, confirmation, tab, onboarding
     step) can reappear over the new one. Persistent records are untouched:
     only this component's state is discarded. */
  const accountKey =
    auth.status === "signed-in" ? `user:${auth.user?.id ?? ""}` : auth.status;

  return <LivantaApp key={accountKey} coordinator={coordinator} />;
}

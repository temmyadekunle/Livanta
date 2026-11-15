/**
 * Optional cloud sync, shown on the Profile screen.
 *
 * Two rules shape this component:
 *   - It renders a plain explanation and nothing else when the app was built
 *     without Supabase credentials, so a build without cloud support looks
 *     deliberate rather than broken.
 *   - Passwords are held in component state only long enough to submit, and
 *     are never logged or stored locally.
 */

import { useState } from "react";

import type { Translate } from "../lib/i18n.ts";
import type { UseAuth } from "../lib/useAuth.ts";
import type { UseCloudSync } from "../lib/useCloudSync.ts";

interface Props {
  t: Translate;
  auth: UseAuth;
  sync: UseCloudSync;
  onSignOut?: () => Promise<void>;
}

type Mode = "sign-in" | "sign-up";

export function AccountPanel({ t, auth, sync, onSignOut }: Props) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!auth.enabled) {
    return (
      <section className="card">
        <p className="section-label">{t("account.title")}</p>
        <div className="card-meta">{t("account.notConfigured")}</div>
      </section>
    );
  }

  if (auth.status === "signed-in") {
    return (
      <section className="card">
        <p className="section-label">{t("account.title")}</p>

        <div className="row">
          <span className="lead">👤</span>
          <span className="grow">
            <div className="name">{t("account.signedInAs", { email: auth.user?.email ?? "" })}</div>
            <div className="sub">{syncLabel(t, sync)}</div>
          </span>
        </div>

        {!sync.suspended && sync.lastResult && sync.lastResult.at ? (
          <div className="card-meta">
            {t("sync.lastSynced", { time: formatTime(sync.lastResult.at) })}
          </div>
        ) : null}

        {auth.error ? (
          <div className="card-meta">{errorLabel(t, auth.error.code)}</div>
        ) : null}

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            if (onSignOut) {
              void onSignOut();
            } else {
              void auth.signOut();
            }
          }}
        >
          {t("account.signOut")}
        </button>

        {/* Hidden while sync is suspended: the handler returns before doing
            anything, so the control could only ever look like a failed sync. */}
        {!sync.suspended ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={sync.phase === "syncing"}
            onClick={() => void sync.syncNow()}
          >
            {sync.phase === "syncing" ? t("sync.syncing") : t("sync.now")}
          </button>
        ) : null}
      </section>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !email || !password) return;

    setBusy(true);
    if (mode === "sign-in") {
      const ok = await auth.signIn(email, password);
      if (!ok) setPassword("");
      setBusy(false);
      return;
    }

    const outcome = await auth.signUp(email, password);
    // Only clear the password on failure; on success the form unmounts anyway.
    if (!outcome.ok) setPassword("");
    setBusy(false);
  }

  return (
    <section className="card">
      <p className="section-label">{t("account.title")}</p>
      <div className="card-meta">{t("account.subtitle")}</div>

      <form onSubmit={submit}>
        <label className="field">
          <span>{t("account.email")}</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>{t("account.password")}</span>
          <input
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {auth.error ? <div className="card-meta">{errorLabel(t, auth.error.code)}</div> : null}

        <button type="submit" className="btn btn-primary" disabled={busy || !email || !password}>
          {mode === "sign-in" ? t("account.signIn") : t("account.signUp")}
        </button>
      </form>

      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          auth.clearError();
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
        }}
      >
        {mode === "sign-in" ? t("account.needAccount") : t("account.haveAccount")}
      </button>

      <div className="card-meta">{t("sync.offline")}</div>
    </section>
  );
}

export function syncLabel(t: Translate, sync: UseCloudSync): string {
  // Suspension is the honest answer before any network state: nothing can have
  // been uploaded, so no other label applies.
  if (sync.suspended) return t("sync.offline");
  if (!sync.online) return t("sync.offlineNet");
  if (sync.phase === "syncing") return t("sync.syncing");
  if (sync.phase === "error") return t("sync.failed");
  if (sync.enabled && sync.signedIn && sync.dataSaver) return t("sync.paused");
  if (!sync.lastResult || !sync.lastResult.at) return t("sync.never");
  return t("sync.done");
}

export function errorLabel(t: Translate, code: string): string {
  if (code === "invalid-credentials") return t("auth.invalid");
  if (code === "email-taken") return t("auth.emailTaken");
  if (code === "rate-limited") return t("auth.rateLimited");
  if (code === "sign-out-failed") return t("auth.signOutFailed");
  return t("auth.unknown");
}

/**
 * A plain local timestamp rather than toLocaleTimeString, which would render
 * in the browser's locale rather than the one the user picked in the app and
 * so disagree with every other date in the interface.
 */
export function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}
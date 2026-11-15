"use client";

/**
 * Dedicated account screens: sign in, sign up, and password reset.
 *
 * These are separate screens rather than the inline panel on Profile because
 * typing an email and a password inside a scrolling settings list is exactly
 * the pattern that makes an app feel like a website.
 */

import { useState } from "react";

import { Icon } from "./Icons";
import { Logo } from "./Logo";
import { Notice } from "./ui";
import type { Translate } from "@/lib/i18n";
import type { UseAuth } from "@/lib/useAuth";

type Mode = "welcome" | "sign-in" | "sign-up" | "forgot" | "new-password";

export function AuthScreen({
  t,
  auth,
  onClose,
  onDone,
  onSignOut,
  initialMode = "sign-in",
}: {
  t: Translate;
  auth: UseAuth;
  onSignOut?: () => Promise<void>;
  /**
   * Optional on purpose. The compulsory gate renders this screen without one,
   * so there is no control that can leave authentication.
   */
  onClose?: () => void;
  onDone: (message: string) => void;
  initialMode?: Mode;
}) {
  const [manualMode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  /* Arriving from an emailed recovery link means the only useful thing to show
     is the new-password form, whichever mode the user last left this screen in.
     Derived rather than synced in an effect: a recovery link establishes a real
     session, so this screen can mount with manualMode at its default, and an
     effect would need a second render to correct it. Naming the derived value
     `mode` keeps every mode comparison below, and the submit handler, correct
     without special-casing. */
  const mode: Mode = auth.passwordResetReady ? "new-password" : manualMode;

  /* A recovery session can end while this form is open: the link expires or
     the user signs out elsewhere. The flag survives that, so without a notice
     and a way back the user would face a form that can never succeed. */
  const recoveryEnded =
    mode === "new-password" &&
    auth.passwordResetReady &&
    auth.status !== "signed-in";

  if (!auth.enabled) {
    return (
      <div className="stack">
        <Notice tone="info" icon="cloud">
          <strong>{t("account.offlineOnly")}</strong>
          <br />
          {t("account.offlineOnlyBody")}
        </Notice>
        {onClose ? (
          <button className="btn btn--secondary btn--block" onClick={onClose}>
            {t("app.back")}
          </button>
        ) : null}
      </div>
    );
  }

  /* A recovery link signs the user in, so this must not claim they are done.
     Without the second condition the recovery session renders the signed-in
     panel and the new-password form is unreachable. */
  if (auth.status === "signed-in" && !auth.passwordResetReady) {
    return (
      <div className="stack">
        <div className="card">
          <div className="rowline">
            <span className="listrow__lead" style={{ color: "var(--ok)" }}>
              <Icon name="checkCircle" size={19} />
            </span>
            <div className="listrow__body">
              <p className="listrow__title">{auth.user?.email}</p>
              <p className="listrow__sub">{t("account.subtitle")}</p>
            </div>
          </div>
        </div>
        {auth.error ? (
          <Notice tone="danger">{errorLabel(t, auth.error.code)}</Notice>
        ) : null}
        <button
          className="btn btn--danger btn--block"
          onClick={() => {
            if (onSignOut) {
              void onSignOut();
            } else {
              void auth.signOut();
            }
          }}
        >
          <Icon name="logOut" size={18} />
          {t("account.signOut")}
        </button>
        {onClose ? (
          <button className="btn btn--ghost btn--block" onClick={onClose}>
            {t("app.back")}
          </button>
        ) : null}
      </div>
    );
  }

  if (mode === "welcome") {
    return (
      <div>
        <div className="ob-brand" style={{ textAlign: "center" }}>
          <Logo variant="wordmark" priority />
          <h2 className="ob-h" style={{ marginTop: "1rem", marginBottom: "0.25rem" }}>
            {t("auth.welcomeTitle")}
          </h2>
          <p className="card-meta">{t("auth.welcomeBlurb")}</p>
        </div>
        {auth.needsEmailConfirmation ? (
          <div style={{ marginTop: "1rem" }}>
            <Notice tone="info" icon="mail">
              <strong>{t("auth.checkEmailTitle")}</strong>
              <br />
              {t("auth.checkEmailBody")}
            </Notice>
          </div>
        ) : null}
        <div className="stack" style={{ marginTop: "1.5rem" }}>
          <button
            className="btn btn--primary btn--lg btn--block"
            onClick={() => {
              auth.clearError();
              setMode("sign-up");
            }}
          >
            {t("auth.signUpTitle")}
          </button>
          <button
            className="btn btn--secondary btn--lg btn--block"
            onClick={() => {
              auth.clearError();
              setMode("sign-in");
            }}
          >
            {t("auth.signInTitle")}
          </button>
        </div>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (mode === "forgot") {
      if (!email.trim()) return;
      setBusy(true);
      const ok = await auth.resetPassword(email);
      setBusy(false);
      if (ok) {
        setSent(true);
        onDone(t("auth.resetSent"));
      }
      return;
    }

    if (mode === "new-password") {
      if (password.length < 6) return;
      setBusy(true);
      const ok = await auth.updatePassword(password);
      setBusy(false);
      if (ok) {
        setPassword("");
        setMode("sign-in");
        onDone(t("auth.passwordUpdated"));
      }
      return;
    }

    if (!email.trim() || !password) return;
    setBusy(true);

    if (mode === "sign-in") {
      const ok = await auth.signIn(email, password);
      setBusy(false);
      if (!ok) {
        setPassword("");
        return;
      }
      onDone(t("auth.signedInToast"));
      return;
    }

    /* The outcome carries the confirmation requirement directly. Reading
       auth.needsEmailConfirmation here would read the snapshot from the render
       before submission, which is exactly how a sign-up awaiting confirmation
       used to claim the user was signed in. */
    const outcome = await auth.signUp(email, password);
    setBusy(false);
    if (!outcome.ok) {
      setPassword("");
      return;
    }
    onDone(
      outcome.needsEmailConfirmation
        ? t("auth.checkEmail")
        : t("auth.signedUpToast"),
    );
  }

  const title =
    mode === "sign-in"
      ? t("auth.signInTitle")
      : mode === "sign-up"
        ? t("auth.signUpTitle")
        : mode === "forgot"
          ? t("auth.forgotTitle")
          : t("auth.newPasswordTitle");

  const blurb =
    mode === "sign-in"
      ? t("auth.signInBlurb")
      : mode === "sign-up"
        ? t("auth.signUpBlurb")
        : mode === "forgot"
          ? t("auth.forgotBlurb")
          : t("auth.newPasswordBlurb");

  return (
    <div>
      <div className="ob-brand" style={{ textAlign: "left", marginBottom: "1rem" }}>
        <h2 className="ob-h" style={{ marginBottom: "0.25rem" }}>
          {title}
        </h2>
        <p className="card-meta">{blurb}</p>
      </div>

      {auth.needsEmailConfirmation &&
      (mode === "sign-in" || mode === "sign-up") ? (
        <div style={{ marginBottom: "0.875rem" }}>
          <Notice tone="info" icon="mail">
            <strong>{t("auth.checkEmailTitle")}</strong>
            <br />
            {t("auth.checkEmailBody")}
          </Notice>
        </div>
      ) : null}

      <form onSubmit={submit}>
        {recoveryEnded ? (
          <div style={{ marginBottom: "0.875rem" }}>
            <Notice tone="danger">
              <strong>{t("auth.recoveryEndedTitle")}</strong>
              <br />
              {t("auth.recoveryEndedBody")}
            </Notice>
          </div>
        ) : null}

        {mode !== "new-password" ? (
          <div className="field">
            <label htmlFor="a-email">{t("account.email")}</label>
            <input
              id="a-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>
        ) : null}

        {mode !== "forgot" ? (
          <div className="field">
            <label htmlFor="a-password">{t("account.password")}</label>
            <div style={{ position: "relative" }}>
              <input
                id="a-password"
                type={show ? "text" : "password"}
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: "3rem" }}
              />
              <button
                type="button"
                className="searchbar__clear"
                style={{ right: "0.125rem" }}
                onClick={() => setShow((v) => !v)}
                aria-label={show ? t("auth.hidePassword") : t("auth.showPassword")}
              >
                <Icon name={show ? "eyeOff" : "eye"} size={18} />
              </button>
            </div>
            {mode === "sign-up" ? (
              <p className="hint">{t("auth.passwordHint")}</p>
            ) : null}
          </div>
        ) : null}

        {auth.error ? (
          <div style={{ marginBottom: "0.875rem" }}>
            <Notice tone="danger">{errorLabel(t, auth.error.code)}</Notice>
          </div>
        ) : null}

        {sent && mode === "forgot" ? (
          <div style={{ marginBottom: "0.875rem" }}>
            <Notice tone="ok" icon="mail">
              {t("auth.resetSentBody")}
            </Notice>
          </div>
        ) : null}

<button
          type="submit"
          className="btn btn--primary btn--lg btn--block"
          disabled={
            busy ||
            recoveryEnded ||
            (mode === "forgot" ? !email.trim() : mode === "new-password" ? password.length < 6 : !email.trim() || !password)
          }
        >
          {busy ? (
            t("auth.working")
          ) : mode === "sign-in" ? (
            t("auth.signInTitle")
          ) : mode === "sign-up" ? (
            t("auth.signUpTitle")
          ) : mode === "forgot" ? (
            t("auth.forgotTitle")
          ) : (
            t("auth.savePassword")
          )}
        </button>

        {mode === "sign-in" && auth.enabled && (
          <div className="stack stack--tight" style={{ marginTop: "0.875rem" }}>
            <div className="divider" style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--ink-400)", fontSize: "0.75rem" }}>
              <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} />
              {t("auth.or")}
              <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} />
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => void auth.signInWithGoogle()}
              disabled={busy}
            >
              <Icon name="google" size={20} />
              <span style={{ marginLeft: "0.5rem" }}>{t("auth.signInWithGoogle")}</span>
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => void auth.signInWithApple()}
              disabled={busy}
            >
              <Icon name="apple" size={20} />
              <span style={{ marginLeft: "0.5rem" }}>{t("auth.signInWithApple")}</span>
            </button>
          </div>
        )}

        <div className="stack stack--tight" style={{ marginTop: "0.875rem" }}>
        {mode === "sign-in" ? (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => {
                auth.clearError();
                setMode("sign-up");
              }}
            >
              {t("account.needAccount")}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => {
                auth.clearError();
                setMode("forgot");
              }}
            >
              {t("auth.forgotLink")}
            </button>
          </>
        ) : null}

        {mode === "sign-up" ? (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => {
              auth.clearError();
              setMode("sign-in");
            }}
          >
            {t("account.haveAccount")}
          </button>
        ) : null}

        {mode === "forgot" ? (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => {
                setSent(false);
                setMode("sign-in");
              }}
            >
              {t("auth.backToSignIn")}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => {
                setSent(false);
                setMode("new-password");
              }}
            >
              {t("auth.haveResetLink")}
            </button>
          </>
        ) : null}

        {mode === "new-password" &&
        (!auth.passwordResetReady || auth.status !== "signed-in") ? (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => {
              if (auth.passwordResetReady) auth.cancelPasswordReset();
              setPassword("");
              setSent(false);
              setMode("sign-in");
            }}
          >
            {t("auth.backToSignIn")}
          </button>
        ) : null}
      </div>

      </form>

      <p className="card-meta" style={{ marginTop: "1rem", textAlign: "center" }}>
        {t("sync.offline")}
      </p>
    </div>
  );
}

function errorLabel(t: Translate, code: string): string {
  if (code === "invalid-credentials") return t("auth.invalid");
  if (code === "email-taken") return t("auth.emailTaken");
  if (code === "rate-limited") return t("auth.rateLimited");
  if (code === "sign-out-failed") return t("auth.signOutFailed");
  return t("auth.unknown");
}
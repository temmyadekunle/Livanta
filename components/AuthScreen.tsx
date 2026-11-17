"use client";

/**
 * Dedicated account screens: sign in, sign up, and password reset.
 *
 * These are separate screens rather than the inline panel on Profile because
 * typing an email and a password inside a scrolling settings list is exactly
 * the pattern that makes an app feel like a website.
 */

import { useEffect, useRef, useState } from "react";

import { Avatar } from "./Avatar";
import { CropSheet } from "./CropSheet";
import { Icon } from "./Icons";
import { Logo } from "./Logo";
import { Notice } from "./ui";
import { AvatarProblem, readAvatar } from "@/lib/avatar";
import type { Locale, Translate } from "@/lib/i18n";
import { saveRegistrationProfile } from "@/lib/registrationProfile";
import type { UseAuth } from "@/lib/useAuth";

type Mode = "welcome" | "sign-in" | "sign-up" | "forgot" | "new-password";

/** What the screen just completed, where the caller needs to tell them apart. */
export type AuthOutcome =
  | "signed-in"
  | "confirmation-pending"
  | "password-reset-sent"
  | "password-updated";

export function AuthScreen({
  t,
  auth,
  onClose,
  onDone,
  onSignOut,
  initialMode = "sign-in",
  forceEntry = false,
  locale,
}: {
  t: Translate;
  auth: UseAuth;
  onSignOut?: () => Promise<void>;
  /**
   * Optional on purpose. The compulsory gate renders this screen without one,
   * so there is no control that can leave authentication.
   */
  onClose?: () => void;
  onDone: (message: string, outcome?: AuthOutcome) => void;
  initialMode?: Mode;
  /** The entry flow's language, carried into a new account's first run. */
  locale?: Locale;
  /**
   * The entry flow renders this screen even when a session was restored, so
   * the signed-in summary must not replace the welcome choice. The session is
   * still offered, explicitly, as "Continue as …".
   */
  forceEntry?: boolean;
}) {
  const [manualMode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<{
    tone: "ok" | "danger";
    text: string;
  } | null>(null);

  /* Arriving from an emailed recovery link means the only useful thing to show
     is the new-password form, whichever mode the user last left this screen in.
     Derived rather than synced in an effect: a recovery link establishes a real
     session, so this screen can mount with manualMode at its default, and an
     effect would need a second render to correct it. Naming the derived value
     `mode` keeps every mode comparison below, and the submit handler, correct
     without special-casing. */
  const mode: Mode = auth.passwordResetReady ? "new-password" : manualMode;

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  function closeCrop() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setCropSrc(null);
  }

  function pickPhoto(input: HTMLInputElement) {
    const file = input.files?.[0];
    // Allow the same file to be picked again after a cancel or a failure.
    input.value = "";
    if (!file) return;
    closeCrop();
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setCropSrc(objectUrl);
    setPhotoError(null);
  }

  async function cropAvatar(blob: Blob) {
    closeCrop();
    try {
      setAvatarDraft(await readAvatar(blob));
      setPhotoError(null);
    } catch (error) {
      const reason = error instanceof AvatarProblem ? error.reason : "could-not-read";
      setPhotoError(
        reason === "too-large"
          ? t("prof.photoTooLarge")
          : reason === "not-an-image"
            ? t("prof.photoNotImage")
            : t("prof.photoFailed"),
      );
    }
  }

  /* A recovery session can end while this form is open: the link expires or
     the user signs out elsewhere. The flag survives that, so without a notice
     and a way back the user would face a form that can never succeed. */
  const recoveryEnded =
    mode === "new-password" &&
    auth.passwordResetReady &&
    auth.status !== "signed-in";

  /* A failed confirmation link is the only evidence that the click did not
     establish a session. Without it the gate looks like an ordinary signed-out
     start, which is how an older session can be mistaken for the new account. */
  const confirmationNotice = auth.confirmationError ? (
    <Notice tone="danger">
      <strong>{t("auth.confirmLinkTitle")}</strong>
      <br />
      {auth.confirmationError === "expired"
        ? t("auth.confirmLinkExpiredBody")
        : t("auth.confirmLinkInvalidBody")}
    </Notice>
  ) : null;

  async function resendPendingConfirmation() {
    const address = auth.pendingEmail;
    if (!address || resending) return;
    setResending(true);
    setResendStatus(null);
    const outcome = await auth.resendConfirmation(address);
    setResending(false);
    // Only a request Supabase accepted may be described as sent.
    setResendStatus(
      outcome.ok
        ? { tone: "ok", text: t("auth.resendSent") }
        : { tone: "danger", text: authErrorLabel(t, outcome.error.code) },
    );
  }

  function chooseDifferentEmail() {
    // Presentation only: the unconfirmed account in Supabase is left untouched.
    auth.clearPendingConfirmation();
    auth.clearError();
    setResendStatus(null);
    setSent(false);
    setPassword("");
    setEmail("");
    setMode("sign-up");
  }

  /* The pending prompt survives a reload, so it must carry the two ways out
     that do not require inventing a second account: ask for another email,
     or stop waiting on this address. */
  const pendingNotice =
    auth.needsEmailConfirmation && !auth.confirmationError ? (
      <Notice tone="info" icon="mail">
        <strong>{t("auth.checkEmailTitle")}</strong>
        <br />
        {t("auth.checkEmailBody")}
        {resendStatus ? (
          <p
            role="status"
            style={{
              marginTop: "0.5rem",
              color:
                resendStatus.tone === "danger" ? "var(--danger)" : "var(--ok)",
            }}
          >
            {resendStatus.text}
          </p>
        ) : null}
        <div className="stack stack--tight" style={{ marginTop: "0.625rem" }}>
          {auth.pendingEmail ? (
            <button
              type="button"
              className="btn btn--soft btn--sm"
              onClick={() => void resendPendingConfirmation()}
              disabled={resending}
            >
              {resending ? t("auth.working") : t("auth.resendConfirmation")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={chooseDifferentEmail}
          >
            {t("auth.useDifferentEmail")}
          </button>
        </div>
      </Notice>
    ) : null;

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
     panel and the new-password form is unreachable. During the mandatory entry
     flow a restored session must still see the welcome choice, so the summary
     is skipped there too. */
  if (auth.status === "signed-in" && !auth.passwordResetReady && !forceEntry) {
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
          <Notice tone="danger">{authErrorLabel(t, auth.error.code)}</Notice>
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
        {confirmationNotice ? (
          <div style={{ marginTop: "1rem" }}>{confirmationNotice}</div>
        ) : null}
        {pendingNotice ? (
          <div style={{ marginTop: "1rem" }}>{pendingNotice}</div>
        ) : null}
        <div className="stack" style={{ marginTop: "1.5rem" }}>
          <p className="card-meta" style={{ marginBottom: "0.25rem" }}>
            {t("auth.newToLivanta")}
          </p>
          <button
            className="btn btn--primary btn--lg btn--block"
            onClick={() => {
              auth.clearError();
              setMode("sign-up");
            }}
          >
            {t("auth.signUpTitle")}
          </button>
          <p className="card-meta" style={{ margin: "0.5rem 0 0.25rem" }}>
            {t("auth.alreadyHaveAccount")}
          </p>
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
        onDone(t("auth.resetSent"), "password-reset-sent");
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
        onDone(t("auth.passwordUpdated"), "password-updated");
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
      onDone(t("auth.signedInToast"), "signed-in");
      return;
    }

    /* The outcome carries the confirmation requirement directly. Reading
       auth.needsEmailConfirmation here would read the snapshot from the render
       before submission, which is exactly how a sign-up awaiting confirmation
       used to claim the user was signed in. */
    const outcome = await auth.signUp(email, password);
    if (!outcome.ok) {
      setBusy(false);
      setPassword("");
      return;
    }

    /* Saved only when Supabase returned both an id and an identity. The
       empty-identity response for an existing address is not proof of a new
       account, so it gets no local profile write. */
    let profileSaved = true;
    if (outcome.newAccount && outcome.userId) {
      profileSaved = await saveRegistrationProfile(outcome.userId, {
        displayName: firstName,
        avatar: avatarDraft,
        locale,
      });
    }
    setBusy(false);
    setFirstName("");
    setAvatarDraft("");
    setPhotoError(null);

    onDone(
      outcome.needsEmailConfirmation
        ? profileSaved
          ? t("auth.checkEmail")
          : t("auth.checkEmailProfileFailed")
        : profileSaved
          ? t("auth.signedUpToast")
          : t("auth.signedUpProfileFailed"),
      outcome.needsEmailConfirmation ? "confirmation-pending" : "signed-in",
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

      {confirmationNotice && (mode === "sign-in" || mode === "sign-up") ? (
        <div style={{ marginBottom: "0.875rem" }}>{confirmationNotice}</div>
      ) : null}

      {pendingNotice && (mode === "sign-in" || mode === "sign-up") ? (
        <div style={{ marginBottom: "0.875rem" }}>{pendingNotice}</div>
      ) : null}

      {mode === "sign-in" && forceEntry && auth.status === "signed-in" && !auth.passwordResetReady && auth.user?.email ? (
        <div style={{ marginBottom: "0.875rem" }}>
          <button
            type="button"
            className="btn btn--soft btn--block"
            onClick={() => onDone(t("auth.signedInToast"), "signed-in")}
          >
            {t("auth.continueAs", { email: auth.user.email })}
          </button>
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

        {mode === "sign-up" ? (
          <div className="field">
            <label htmlFor="a-first-name">{t("auth.firstName")}</label>
            <input
              id="a-first-name"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={t("auth.firstNamePlaceholder")}
            />
            <p className="hint">{t("auth.firstNameHint")}</p>
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

        {mode === "sign-up" ? (
          <div className="field">
            <span className="section-label">{t("auth.photo")}</span>
            <div className="rowline" style={{ marginTop: "0.5rem", alignItems: "center" }}>
              <label className="avatar-edit">
                <Avatar name={firstName} src={avatarDraft} large />
                <span className="avatar-edit__badge">
                  <Icon name="camera" size={15} />
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => pickPhoto(e.currentTarget)}
                />
                <span className="sr-only">
                  {avatarDraft ? t("prof.changePhoto") : t("auth.addPhoto")}
                </span>
              </label>
              <div className="listrow__body">
                <p className="card-meta">{avatarDraft ? t("auth.photoReady") : t("auth.photoHint")}</p>
                {avatarDraft ? (
                  <button
                    type="button"
                    className="linkbtn"
                    style={{ marginTop: "0.25rem" }}
                    onClick={() => setAvatarDraft("")}
                  >
                    {t("prof.removePhoto")}
                  </button>
                ) : null}
              </div>
            </div>
            {photoError ? (
              <p className="hint" style={{ color: "var(--danger)" }}>
                {photoError}
              </p>
            ) : null}
          </div>
        ) : null}

        {auth.error ? (
          <div style={{ marginBottom: "0.875rem" }}>
            <Notice tone="danger">{authErrorLabel(t, auth.error.code)}</Notice>
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

      {cropSrc ? (
        <CropSheet
          src={cropSrc}
          onCancel={closeCrop}
          onCrop={(blob) => void cropAvatar(blob)}
        />
      ) : null}

      <p className="card-meta" style={{ marginTop: "1rem", textAlign: "center" }}>
        {t("sync.offline")}
      </p>
    </div>
  );
}

/** Shared with the signed-in failed-link banner, which resends as well. */
export function authErrorLabel(t: Translate, code: string): string {
  if (code === "invalid-credentials") return t("auth.invalid");
  if (code === "email-taken") return t("auth.emailTaken");
  if (code === "email-unconfirmed") return t("auth.emailUnconfirmed");
  if (code === "rate-limited") return t("auth.rateLimited");
  if (code === "network") return t("auth.networkError");
  if (code === "sign-out-failed") return t("auth.signOutFailed");
  return t("auth.unknown");
}
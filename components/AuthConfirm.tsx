"use client";

/**
 * The page an emailed confirmation or recovery link lands on.
 *
 * It owns only the handover: verify the token hash, then show the app with the
 * session the link established. A broken link gets its own explanation and a
 * way back to the mandatory gate; it never renders the desk or a dismissal.
 */

import { useEffect } from "react";

import AppEntry from "./AppEntry";
import { Logo } from "./Logo";
import { Notice } from "./ui";
import { hydrateEntryLocale, useEntryGate } from "@/lib/entryGate";
import { makeT } from "@/lib/i18n";
import { useEmailLinkConfirmation } from "@/lib/useEmailLinkConfirmation";

export default function AuthConfirm() {
  const gate = useEntryGate();
  const { phase, error, back } = useEmailLinkConfirmation();
  const t = makeT(gate.locale);

  useEffect(() => {
    hydrateEntryLocale();
  }, []);

  if (phase === "ready") return <AppEntry />;

  return (
    <div className="app" lang={gate.locale}>
      <div className="app__col">
        <header className="appbar">
          <div className="appbar__lead">
            <span className="appbar__logo">
              <Logo />
            </span>
            <div style={{ minWidth: 0 }}>
              <h1 className="appbar__title">{t("account.title")}</h1>
              <p className="appbar__sub">{t("account.subtitle")}</p>
            </div>
          </div>
        </header>
        <main className="app__body" id="app-main" tabIndex={-1}>
          {phase === "checking" ? (
            <div className="stack" role="status" aria-live="polite">
              <p className="card-meta" style={{ textAlign: "center" }}>
                {t("auth.confirmLinkWorking")}
              </p>
            </div>
          ) : (
            <div className="stack">
              <Notice tone="danger">
                <strong>{t("auth.confirmLinkTitle")}</strong>
                <br />
                {error === "expired"
                  ? t("auth.confirmLinkExpiredBody")
                  : t("auth.confirmLinkInvalidBody")}
              </Notice>
              <button
                className="btn btn--secondary btn--block"
                onClick={back}
              >
                {t("app.back")}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

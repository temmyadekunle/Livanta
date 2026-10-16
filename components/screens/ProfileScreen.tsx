"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";

import { Icon } from "../Icons";
import { Logo } from "../Logo";
import { AccountPanel, errorLabel, formatTime, syncLabel } from "../AccountPanel";
import { Avatar } from "../Avatar";
import { LocalePicker } from "../Onboarding";
import { AvatarProblem, readAvatar } from "@/lib/avatar";
import { CropSheet } from "../CropSheet";
import {
  announcePermissionChange,
  downloadJson,
  exportPayload,
  leadDaysCrossed,
  notificationPermission,
  reminderCopy,
  requestNotificationPermission,
  serverPermissionSnapshot,
  subscribeToPermission,
} from "@/lib/notifications";
import { parseImport, planIsEmpty, type ImportPlan } from "@/lib/import";
import type { Locale, Translate } from "@/lib/i18n";
import type { useAuth } from "@/lib/useAuth";
import type { useCloudSync } from "@/lib/useCloudSync";
import type { useLivanta } from "@/lib/useLivanta";

type Desk = ReturnType<typeof useLivanta>;

const LEAD_CHOICES = [90, 60, 30, 14, 7, 1];

/** Skip reasons are kebab-case in the data; the catalogue uses camelCase. */
const SKIP_KEY = {
  "not-object": "import.skip.notObject",
  "missing-name": "import.skip.missingName",
  "too-long": "import.skip.tooLong",
  duplicate: "import.skip.duplicate",
} as const;

export function ProfileScreen({
  desk,
  auth,
  sync,
  onOpenAuth,
  onOpenConfirmDeleteAll,
  showToast,
}: {
  desk: Desk;
  auth: ReturnType<typeof useAuth>;
  sync: ReturnType<typeof useCloudSync>;
  onOpenAuth: () => void;
  onOpenConfirmDeleteAll: () => void;
  showToast: (text: string, tone?: "ok" | "info" | "danger") => void;
}) {
  const { t } = desk;
  const permission = useSyncExternalStore(
    subscribeToPermission,
    notificationPermission,
    serverPermissionSnapshot,
  );
  const name = desk.settings.displayName;
  const [nameDraft, setNameDraft] = useState(name);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  /* A parsed import waits here until the user has seen the preview and
     confirmed. Cancelling (or navigating away) writes nothing. */
  const [pendingImport, setPendingImport] = useState<ImportPlan | null>(null);
  const [importSettingsToo, setImportSettingsToo] = useState(false);

  const onPickImportFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    // Allow the same file to be picked again after a cancel or a failure.
    input.value = "";
    if (!file) return;
    const text = await file.text();
    const result = parseImport(text, { existing: desk.things, now: new Date() });
    if (!result.ok) {
      const errorKey =
        result.error === "invalid-json"
          ? "import.error.json"
          : result.error === "unsupported-version"
            ? "import.error.version"
            : "import.error.file";
      showToast(t(errorKey), "danger");
      return;
    }
    if (planIsEmpty(result.plan)) {
      showToast(t("import.nothing"), "info");
      return;
    }
    setImportSettingsToo(false);
    setPendingImport(result.plan);
  };

  const upcoming = useMemo(
    () =>
      desk.things
        .filter((item) => item.status === "active" && item.dueDate)
        .map((item) => ({ thing: item, leads: leadDaysCrossed(item, desk.settings.leadDays) }))
        .filter((x) => x.leads.length > 0)
        .slice(0, 4),
    [desk.things, desk.settings.leadDays],
  );

  return (
    <>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="profile-id">
          <Logo variant="wordmark" />
          <p className="profile-id__tag">{t("app.tagline")}</p>
        </div>
        <div className="card">
          <div className="rowline">
            {/* A label wrapping the file input rather than a button with an
                onClick that calls input.click(): the picker then opens from the
                keyboard, from a screen reader's activate, and from the tap, with
                no extra handlers and no focus juggling. The input itself is
                hidden but not display:none, or it would be unreachable. */}
            <label className="avatar-edit">
              <Avatar name={name || t("app.brand")} src={desk.settings.avatar} large />
              <span className="avatar-edit__badge">
                <Icon name="camera" size={15} />
              </span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  // Create object URL for the crop sheet
                  const objectUrl = URL.createObjectURL(file);
                  setCropSrc(objectUrl);
                }}
              />
              <span className="sr-only">{t("prof.changePhoto")}</span>
            </label>
            <div className="listrow__body">
              {name ? (
                <h2 className="card-title" style={{ fontSize: "1.0625rem" }}>
                  {name}
                </h2>
              ) : null}
              <p className="card-meta">{t("profile.freePlan")}</p>
              {desk.settings.avatar ? (
                <button
                  className="linkbtn"
                  style={{ marginTop: "0.25rem" }}
                  onClick={() => {
                    void desk.updateSettings({ avatar: "" });
                    showToast(t("prof.photoRemoved"), "info");
                  }}
                >
                  {t("prof.removePhoto")}
                </button>
              ) : null}
            </div>
          </div>
          <div className="field" style={{ marginTop: "0.875rem" }}>
            <label htmlFor="prof-name">{t("prof.name")}</label>
            <input
              id="prof-name"
              value={nameDraft}
              autoComplete="name"
              placeholder={t("prof.namePlaceholder")}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                const next = nameDraft.trim();
                if (next !== desk.settings.displayName) {
                  void desk.updateSettings({ displayName: next });
                }
              }}
            />
            <p className="hint">{t("prof.nameHint")}</p>
          </div>
          <div className="statgrid" style={{ marginTop: "0.875rem" }}>
            <MiniStat n={desk.things.filter((x) => x.status === "active").length} label={t("prof.active")} />
            <MiniStat n={desk.things.filter((x) => x.status === "completed").length} label={t("prof.completed")} />
            <MiniStat n={desk.alerts.length} label={t("tab.alerts")} />
          </div>
        </div>
      </section>

      {auth.enabled ? (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">{t("account.title")}</h2>
          </div>
          <button className="setrow" style={{ borderRadius: "var(--radius)" }} onClick={onOpenAuth}>
            <span className="listrow__lead" style={{ color: "var(--brand-700)" }}>
              <Icon name="cloud" size={19} />
            </span>
            <span className="setrow__body">
              <span className="setrow__title">
                {auth.status === "signed-in"
                  ? t("prof.signedIn")
                  : t("prof.manageAccount")}
              </span>
              <span className="setrow__sub">
                {auth.status === "signed-in"
                  ? auth.user?.email ?? ""
                  : t("prof.manageAccountSub")}
              </span>
            </span>
            <span className="setrow__trail">
              <Icon name="chevronRight" size={18} />
            </span>
          </button>
          {auth.status === "signed-in" ? (
            <p className="card-meta" style={{ margin: "0.5rem 0 0" }}>
              {syncLabel(t, sync)}
              {sync.lastResult && sync.lastResult.at
                ? ` · ${t("sync.lastSynced", { time: formatTime(sync.lastResult.at) })}`
                : ""}
            </p>
          ) : null}
        </section>
      ) : (
        <AccountPanel t={t} auth={auth} sync={sync} />
      )}

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("profile.security")}</h2>
        </div>
        {auth.enabled && auth.status === "signed-in" ? (
          <SecurityForm t={t} auth={auth} showToast={showToast} />
        ) : auth.enabled ? (
          <div className="card">
            <p className="card-meta">{t("profile.signInForPassword")}</p>
          </div>
        ) : (
          <div className="card">
            <p className="card-meta">{t("account.offlineOnly")}</p>
            <p className="card-meta" style={{ marginTop: "0.375rem" }}>
              {t("account.offlineOnlyBody")}
            </p>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("profile.language")}</h2>
        </div>
        <div className="card">
          <LocalePicker
            locale={desk.settings.locale}
            t={t}
            onChange={(locale: Locale) => void desk.updateSettings({ locale })}
          />
          <p className="card-meta" style={{ marginTop: "0.5rem" }}>
            {t("profile.languageHint")}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("profile.notifications")}</h2>
        </div>
        <div className="list">
          {permission === "unsupported" ? (
            <div className="setrow">
              <span className="setrow__sub">{t("profile.notifUnsupported")}</span>
            </div>
          ) : null}
          {permission === "default" ? (
            <button
              className="setrow"
              onClick={async () => {
                await requestNotificationPermission();
                announcePermissionChange();
              }}
            >
              <span className="setrow__body">
                <span className="setrow__title">{t("profile.enableAlerts")}</span>
              </span>
              <span className="setrow__trail">
                <Icon name="chevronRight" size={18} />
              </span>
            </button>
          ) : null}
          {permission === "granted" ? (
            <div className="setrow">
              <span className="setrow__lead" style={{ color: "var(--ok)" }}>
                <Icon name="checkCircle" size={18} />
              </span>
              <span className="setrow__body">
                <span className="setrow__sub">{t("profile.notifGranted")}</span>
              </span>
            </div>
          ) : null}
          {permission === "denied" ? (
            <div className="setrow">
              <span className="setrow__lead" style={{ color: "var(--warn)" }}>
                <Icon name="alert" size={18} />
              </span>
              <span className="setrow__body">
                <span className="setrow__sub">{t("profile.notifDenied")}</span>
              </span>
            </div>
          ) : null}

          <label className="setrow">
            <span className="setrow__body">
              <span className="setrow__title">{t("profile.notifyUrgent")}</span>
            </span>
            <input
              type="checkbox"
              checked={desk.settings.notifyUrgent}
              onChange={(e) => void desk.updateSettings({ notifyUrgent: e.target.checked })}
            />
          </label>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("profile.reminderSchedule")}</h2>
        </div>
        <div className="card">
          <div className="chips" role="group" aria-label={t("profile.reminderSchedule")}>
            {LEAD_CHOICES.map((n) => (
              <button
                key={n}
                className={
                  desk.settings.leadDays.includes(n) ? "chip chip--on" : "chip chip--quiet"
                }
                aria-pressed={desk.settings.leadDays.includes(n)}
                onClick={() =>
                  void desk.updateSettings({
                    leadDays: desk.settings.leadDays.includes(n)
                      ? desk.settings.leadDays.filter((d) => d !== n)
                      : [...desk.settings.leadDays, n].sort((a, b) => b - a),
                  })
                }
              >
                {t("prof.daysShort", { n })}
              </button>
            ))}
          </div>
          {upcoming.length > 0 ? (
            <div style={{ marginTop: "0.875rem" }}>
              <p className="section-label">{t("profile.preview")}</p>
              {upcoming.map(({ thing, leads }) => {
                const copy = reminderCopy(thing, leads[0], t);
                return (
                  <div className="row" key={thing.id}>
                    <span className="grow">
                      <span className="name" style={{ display: "block" }}>
                        {copy.title}
                      </span>
                      <span className="sub" style={{ display: "block" }}>
                        {copy.body}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("profile.data")}</h2>
        </div>
        <div className="list">
          <label className="setrow">
            <span className="setrow__body">
              <span className="setrow__title">{t("profile.dataSaver")}</span>
              <span className="setrow__sub">{t("profile.dataSaverHint")}</span>
            </span>
            <input
              type="checkbox"
              checked={desk.settings.dataSaver}
              onChange={(e) => void desk.updateSettings({ dataSaver: e.target.checked })}
            />
          </label>
          <button
            className="setrow"
            onClick={() => {
              downloadJson("livanta-export.json", exportPayload(desk.things, desk.settings));
              showToast(t("profile.exportDone"), "ok");
            }}
          >
            <span className="listrow__lead">
              <Icon name="download" size={18} />
            </span>
            <span className="setrow__body">
              <span className="setrow__title">{t("profile.export")}</span>
            </span>
            <span className="setrow__trail">
              <Icon name="chevronRight" size={18} />
            </span>
          </button>
          {/* Same label-wraps-input pattern as the avatar picker above: the
              file dialog is the browser's, nothing is written until the
              preview below is confirmed. */}
          <label className="setrow">
            <span className="listrow__lead">
              <Icon name="upload" size={18} />
            </span>
            <span className="setrow__body">
              <span className="setrow__title">{t("profile.import")}</span>
            </span>
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => void onPickImportFile(e.target)}
            />
          </label>
          <button
            className="setrow"
            onClick={() => {
              void desk.loadSampleData();
              showToast(t("profile.loadSample"), "ok");
            }}
          >
            <span className="listrow__lead">
              <Icon name="sparkles" size={18} />
            </span>
            <span className="setrow__body">
              <span className="setrow__title">{t("profile.loadSample")}</span>
            </span>
            <span className="setrow__trail">
              <Icon name="chevronRight" size={18} />
            </span>
          </button>
        </div>
        {pendingImport ? (
          <div className="card" style={{ marginTop: "0.75rem" }}>
            <p className="card-meta" style={{ fontWeight: 600 }}>
              {t("import.preview")}
            </p>
            <p className="card-meta">{t("import.new", { n: pendingImport.add.length })}</p>
            <p className="card-meta">
              {t("import.updated", { n: pendingImport.replace.length })}
            </p>
            <p className="card-meta">{t("import.kept", { n: pendingImport.keepLocal.length })}</p>
            <p className="card-meta">
              {t("import.skipped", { n: pendingImport.skipped.length })}
            </p>
            {pendingImport.adjusted > 0 ? (
              <p className="card-meta">
                {t("import.adjusted", { n: pendingImport.adjusted })}
              </p>
            ) : null}
            {pendingImport.skipped.length > 0 ? (
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
                {pendingImport.skipped.slice(0, 8).map((s) => (
                  <li className="card-meta" key={s.index}>
                    {s.name?.slice(0, 40) || `#${s.index + 1}`} —{" "}
                    {t(SKIP_KEY[s.reason])}
                  </li>
                ))}
              </ul>
            ) : null}
            {pendingImport.settings ? (
              <label className="setrow" style={{ paddingInline: 0 }}>
                <span className="setrow__body">
                  <span className="setrow__title">{t("import.applySettings")}</span>
                </span>
                <input
                  type="checkbox"
                  checked={importSettingsToo}
                  onChange={(e) => setImportSettingsToo(e.target.checked)}
                />
              </label>
            ) : null}
            <button
              className="btn btn--primary btn--block"
              style={{ marginTop: "0.75rem" }}
              onClick={() => {
                const plan = pendingImport;
                if (!plan) return;
                setPendingImport(null);
                void desk.importThings(plan, importSettingsToo).then(() => {
                  showToast(t("import.done"), "ok");
                });
              }}
            >
              {t("import.confirm")}
            </button>
            <button
              className="btn btn--ghost btn--block"
              onClick={() => setPendingImport(null)}
            >
              {t("import.cancel")}
            </button>
          </div>
        ) : null}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("profile.yourData")}</h2>
        </div>
        <div className="card">
          <p className="card-meta">{t.n("profile.yourDataBody", desk.things.length)}</p>
          <button
            className="btn btn--danger btn--block"
            style={{ marginTop: "0.75rem" }}
            onClick={onOpenConfirmDeleteAll}
          >
            <Icon name="trash" size={18} />
            {t("profile.deleteAll")}
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("profile.more")}</h2>
        </div>
        <div className="list">
          <Link className="setrow" href="/landing/#faq">
            <span className="listrow__lead">
              <Icon name="info" size={18} />
            </span>
            <span className="setrow__body">
              <span className="setrow__title">{t("profile.help")}</span>
              <span className="setrow__sub">{t("profile.helpSub")}</span>
            </span>
            <span className="setrow__trail">
              <Icon name="chevronRight" size={18} />
            </span>
          </Link>
          <Link className="setrow" href="/landing/">
            <span className="listrow__lead">
              <Icon name="sparkles" size={18} />
            </span>
            <span className="setrow__body">
              <span className="setrow__title">{t("profile.about")}</span>
              <span className="setrow__sub">{t("app.slogan")}</span>
            </span>
            <span className="setrow__trail">
              <Icon name="chevronRight" size={18} />
            </span>
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{t("profile.legal")}</h2>
        </div>
        {/* Anchors rather than buttons: these leave the app. trailingSlash is
            on, so the hrefs carry the slash the static export writes to disk. */}
        <div className="list">
          <Link className="setrow" href="/privacy/">
            <span className="listrow__lead">
              <Icon name="shieldCheck" size={18} />
            </span>
            <span className="setrow__body">
              <span className="setrow__title">{t("profile.privacy")}</span>
            </span>
            <span className="setrow__trail">
              <Icon name="chevronRight" size={18} />
            </span>
          </Link>
          <Link className="setrow" href="/terms/">
            <span className="listrow__lead">
              <Icon name="file" size={18} />
            </span>
            <span className="setrow__body">
              <span className="setrow__title">{t("profile.terms")}</span>
            </span>
            <span className="setrow__trail">
              <Icon name="chevronRight" size={18} />
            </span>
          </Link>
        </div>
      </section>
      {cropSrc ? (
        <CropSheet
          src={cropSrc}
          onCancel={() => {
            URL.revokeObjectURL(cropSrc);
            setCropSrc(null);
          }}
          onCrop={async (blob) => {
            URL.revokeObjectURL(cropSrc);
            setCropSrc(null);
            try {
              const avatar = await readAvatar(blob);
              await desk.updateSettings({ avatar });
              showToast(t("prof.photoSaved"), "ok");
            } catch (error) {
              const reason = error instanceof AvatarProblem ? error.reason : "could-not-read";
              showToast(
                reason === "too-large"
                  ? t("prof.photoTooLarge")
                  : reason === "not-an-image"
                    ? t("prof.photoNotImage")
                    : t("prof.photoFailed"),
                "danger",
              );
            }
          }}
        />
      ) : null}
    </>
  );
}

function MiniStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <div className="stat-num">{n}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function SecurityForm({
  t,
  auth,
  showToast,
}: {
  t: Translate;
  auth: ReturnType<typeof useAuth>;
  showToast: (text: string, tone?: "ok" | "info" | "danger") => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const longEnough = password.length >= 8;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !longEnough) return;
    setBusy(true);
    const ok = await auth.updatePassword(password);
    setBusy(false);
    if (ok) {
      setPassword("");
      showToast(t("auth.passwordUpdated"), "ok");
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <label className="field">
        <span>{t("auth.newPasswordTitle")}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            auth.clearError();
          }}
        />
      </label>
      <p className="hint">{t("auth.passwordHint")}</p>
      {auth.error ? (
        <p className="hint" style={{ color: "var(--danger)" }}>
          {errorLabel(t, auth.error.code)}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={busy || !longEnough}
      >
        {busy ? t("auth.working") : t("auth.savePassword")}
      </button>
    </form>
  );
}
/**
 * Profile identity across account switching.
 *
 * Two accounts with different display names and emails must never see each
 * other's settings or address in the profile. The store and the signed-in
 * identity are separate inputs, so these tests pass both and switch them
 * independently: the profile follows the live session, and a store that does
 * not belong to that session exposes no records at all.
 */

import test from "node:test";
import { register } from "node:module";
import type { ReactElement } from "react";

register("./tsx-loader.mjs", import.meta.url);

import { assert } from "./helpers.ts";
import type { UseAuth } from "../lib/useAuth.ts";
import type { UseCloudSync } from "../lib/useCloudSync.ts";
import type { LocalStore } from "../lib/db.ts";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { Window } = await import("happy-dom");
const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");

const win = new Window({ url: "https://livanta.test/" });
define("window", win);
define("document", win.document);
define("navigator", win.navigator);
define("location", win.location);
define("indexedDB", indexedDB);
define("IDBKeyRange", IDBKeyRange);
define("IS_REACT_ACT_ENVIRONMENT", true);

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { ProfileScreen } = await import("../components/screens/ProfileScreen.tsx");
const { useLivanta } = await import("../lib/useLivanta.ts");
const { createLocalStore, userScope } = await import("../lib/db.ts");
const { DEFAULT_SETTINGS, saveSettings } = await import("../lib/settings.ts");

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const SYNC: UseCloudSync = {
  enabled: false,
  signedIn: false,
  phase: "idle",
  lastResult: null,
  online: true,
  dataSaver: false,
  suspended: true,
  suspendedReason: null,
  bindRefresh: () => {},
  scheduleSync: () => {},
  syncNow: async () => {},
};

function authFor(email: string): UseAuth {
  return {
    enabled: true,
    status: "signed-in",
    user: { id: email, email } as UseAuth["user"],
    error: null,
    needsEmailConfirmation: false,
    confirmationError: null,
    clearConfirmationError: () => {},
    pendingEmail: null,
    resendConfirmation: async () => ({ ok: true as const }),
    clearPendingConfirmation: () => {},
    passwordResetReady: false,
    signIn: async () => true,
    signUp: async () => ({ ok: true, needsEmailConfirmation: false }),
    resetPassword: async () => true,
    updatePassword: async () => true,
    cancelPasswordReset: () => {},
    signOut: async () => {},
    teardownPending: false,
    retryTransition: async () => {},
    clearError: () => {},
    retrySession: async () => {},
    signInWithGoogle: async () => true,
    signInWithApple: async () => true,
  };
}

interface Props {
  store: LocalStore;
  userId: string;
  auth: UseAuth;
}

function mountProfile(initial: Props) {
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);

  function Probe({ store, userId, auth }: Props): ReactElement {
    const desk = useLivanta(store, userId);
    return (
      <ProfileScreen
        desk={desk}
        auth={auth}
        sync={SYNC}
        onOpenAuth={() => {}}
        onOpenConfirmDeleteAll={() => {}}
        showToast={() => {}}
      />
    );
  }

  act(() => root.render(<Probe {...initial} />));

  return {
    text: () => container.textContent ?? "",
    render(next: Props) {
      act(() => root.render(<Probe {...next} />));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, label: string, text: () => string) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await act(async () => {
      await delay(5);
    });
  }
  throw new Error(`Timed out waiting for ${label}; text=${JSON.stringify(text())}`);
}

test("the profile shows the live account's name and address, not the previous account's", async () => {
  const storeA = createLocalStore(userScope(A_ID));
  const storeB = createLocalStore(userScope(B_ID));

  try {
    await saveSettings(storeA, {
      ...DEFAULT_SETTINGS,
      onboarded: true,
      displayName: "Adaeze",
    });
    await saveSettings(storeB, {
      ...DEFAULT_SETTINGS,
      onboarded: true,
      displayName: "Bode",
    });

    const view = mountProfile({
      store: storeA,
      userId: A_ID,
      auth: authFor("ada@example.com"),
    });
    await waitFor(
      () => view.text().includes("Adaeze"),
      "account A's settings",
      view.text,
    );
    assert.ok(view.text().includes("ada@example.com"));
    assert.equal(view.text().includes("Bode"), false);
    assert.equal(view.text().includes("bode@example.com"), false);

    view.render({
      store: storeB,
      userId: B_ID,
      auth: authFor("bode@example.com"),
    });
    await waitFor(
      () => view.text().includes("Bode"),
      "account B's settings",
      view.text,
    );
    assert.ok(view.text().includes("bode@example.com"));
    assert.equal(view.text().includes("Adaeze"), false);
    assert.equal(view.text().includes("ada@example.com"), false);

    // The store and the session disagree: the render-time owner guard must
    // expose neither account's records rather than showing B under A's session.
    view.render({
      store: storeB,
      userId: A_ID,
      auth: authFor("ada@example.com"),
    });
    await waitFor(
      () => !view.text().includes("Bode"),
      "the owner guard to hide B's settings",
      view.text,
    );
    assert.equal(view.text().includes("Adaeze"), false);
    assert.equal(view.text().includes("Ada's"), false);

    view.unmount();
  } finally {
    await storeA.close();
    await storeB.close();
  }
});

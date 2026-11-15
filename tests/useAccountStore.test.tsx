/**
 * useAccountStore is the only place that turns an auth snapshot into a local
 * store. These tests pin that it delegates the decision to resolveLocalScope:
 * no component grows its own notion of when a store may exist, no signed-out
 * state reaches the anonymous database, and a malformed identity produces a
 * visible error surface rather than an empty desk.
 */
import { register } from "node:module";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { assert } from "./helpers.ts";
import type { UseAccountStoreInput } from "../lib/useAccountStore.ts";

register("./tsx-loader.mjs", import.meta.url);

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { Window } = await import("happy-dom");
const fake = await import("fake-indexeddb");

const win = new Window({ url: "https://livanta.test/" });
define("window", win);
define("document", win.document);
define("navigator", win.navigator);
define("location", win.location);
define("indexedDB", fake.indexedDB);
define("IDBKeyRange", fake.IDBKeyRange);
define("IS_REACT_ACT_ENVIRONMENT", true);

const { useAccountStore } = await import("../lib/useAccountStore.ts");
const { anonymousStore, closeScope, userScope } = await import("../lib/db.ts");
type Output = ReturnType<typeof useAccountStore>;

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function mount(initial: UseAccountStoreInput) {
  let latest: Output | undefined;
  const container = win.document.createElement("div");
  const root = createRoot(container as unknown as Element);

  function Probe(props: UseAccountStoreInput) {
    latest = useAccountStore(props);
    return null;
  }

  act(() => root.render(<Probe {...initial} />));

  return {
    get output(): Output {
      if (!latest) throw new Error("hook never rendered");
      return latest;
    },
    render(next: UseAccountStoreInput) {
      act(() => root.render(<Probe {...next} />));
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

test.after(async () => {
  await closeScope(userScope(USER_ID));
  await closeScope(anonymousStore.scope);
});

test("a signed-in session with a valid id gets that account's own store", () => {
  const view = mount({ authEnabled: true, authStatus: "signed-in", userId: USER_ID });

  assert.equal(view.output.status, "account");
  assert.equal(view.output.expectedUserId, USER_ID);
  assert.ok(view.output.store);
  assert.equal(view.output.store.scope.kind, "user");
  if (view.output.store.scope.kind === "user") {
    assert.equal(view.output.store.scope.userId, USER_ID);
  }
  assert.notEqual(view.output.store, anonymousStore);
  view.unmount();
});

test("id casing resolves to the same account, not a second store", () => {
  const lower = mount({ authEnabled: true, authStatus: "signed-in", userId: USER_ID });
  const lowerStore = lower.output.store;
  lower.unmount();

  const upper = mount({
    authEnabled: true,
    authStatus: "signed-in",
    userId: USER_ID.toUpperCase(),
  });
  const upperStore = upper.output.store;

  assert.ok(lowerStore && upperStore);
  if (
    lowerStore?.scope.kind === "user" &&
    upperStore?.scope.kind === "user"
  ) {
    assert.equal(upperStore.scope.userId, lowerStore.scope.userId);
  }
  upper.unmount();
});

test("a signed-in session with an unusable id exposes no store at all", () => {
  const view = mount({ authEnabled: true, authStatus: "signed-in", userId: "not-a-uuid" });

  assert.equal(view.output.store, null);
  assert.equal(view.output.status, "error");
  assert.equal(view.output.errorReason, "invalid-user");
  assert.equal(view.output.expectedUserId, null);
  view.unmount();
});

test("a signed-out session never falls back to the anonymous database", () => {
  const view = mount({
    authEnabled: true,
    authStatus: "signed-out",
    userId: USER_ID,
  });

  assert.equal(view.output.store, null);
  assert.equal(view.output.status, "unavailable");
  view.unmount();
});

test("a session still loading exposes no store", () => {
  const view = mount({ authEnabled: true, authStatus: "loading", userId: null });

  assert.equal(view.output.store, null);
  assert.equal(view.output.status, "pending");
  view.unmount();
});

test("a failed session read is an error, not an empty account", () => {
  const view = mount({ authEnabled: true, authStatus: "error", userId: null });

  assert.equal(view.output.store, null);
  assert.equal(view.output.status, "error");
  assert.equal(view.output.errorReason, "auth-error");
  view.unmount();
});

test("an auth-disabled build keeps the offline anonymous store", () => {
  const view = mount({ authEnabled: false, authStatus: "disabled", userId: null });

  assert.equal(view.output.status, "anonymous");
  assert.equal(view.output.store, anonymousStore);
  assert.equal(view.output.expectedUserId, null);
  view.unmount();
});

test("an inconsistent disabled status with auth enabled exposes no store", () => {
  const view = mount({ authEnabled: true, authStatus: "disabled", userId: null });

  assert.equal(view.output.store, null);
  assert.equal(view.output.status, "error");
  assert.equal(view.output.errorReason, "auth-disabled-conflict");
  view.unmount();
});

test("bumping the reset token replaces the store for the same account", () => {
  const view = mount({
    authEnabled: true,
    authStatus: "signed-in",
    userId: USER_ID,
    resetToken: 0,
  });
  const first = view.output.store;

  view.render({
    authEnabled: true,
    authStatus: "signed-in",
    userId: USER_ID,
    resetToken: 1,
  });
  const second = view.output.store;

  assert.ok(first && second);
  assert.notEqual(first, second, "a revoked store must not be handed back");
  view.unmount();
});

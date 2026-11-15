/**
 * Cross-tab identity transport (ADR 0002 §5.3, D5).
 *
 * These tests exercise the real transport module. BroadcastChannel is Node's
 * real implementation; the storage fallback is a second document's device that
 * only fires `storage` events for writes made by another tab, as a browser
 * does.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  broadcastIdentityChange,
  identityTransportKind,
  setIdentityStorageForTesting,
  setIdentityTransportForTesting,
  subscribeToIdentityChanges,
  type IdentityMessage,
  type IdentityStorage,
  type IdentityStorageEvent,
  IDENTITY_CHANNEL_NAME,
  IDENTITY_STORAGE_KEY,
} from "../lib/identityTransport.ts";

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

interface FakeStorage {
  readonly port: IdentityStorage;
  readonly writes: Array<[string, string]>;
  emitFromOtherTab(key: string | null, newValue: string | null): void;
}

function fakeStorage(): FakeStorage {
  const items = new Map<string, string>();
  const writes: Array<[string, string]> = [];
  const listeners = new Set<(event: IdentityStorageEvent) => void>();
  return {
    port: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
        writes.push([key, value]);
      },
      removeItem: (key) => {
        items.delete(key);
      },
      addEventListener: (type, listener) => {
        if (type === "storage") listeners.add(listener);
      },
      removeEventListener: (type, listener) => {
        if (type === "storage") listeners.delete(listener);
      },
    },
    writes,
    emitFromOtherTab(key, newValue) {
      for (const listener of [...listeners]) listener({ key, newValue });
    },
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not met in time");
}

test.beforeEach(() => {
  setIdentityStorageForTesting(null);
  setIdentityTransportForTesting(null);
});

test.after(() => {
  setIdentityStorageForTesting(null);
  setIdentityTransportForTesting(null);
});

test("prefers BroadcastChannel when it is available", async () => {
  assert.equal(identityTransportKind(), "broadcast");

  const received: IdentityMessage[] = [];
  const unsubscribe = subscribeToIdentityChanges((message) => {
    received.push(message);
  });

  const otherTab = new BroadcastChannel(IDENTITY_CHANNEL_NAME);
  try {
    otherTab.postMessage({
      type: "livanta:identity-change",
      reason: "switch",
      timestamp: Date.now(),
      id: "sig-broadcast-1",
    });

    await waitFor(() => received.length === 1);

    assert.equal(received[0].reason, "switch");
    assert.equal(received[0].type, "livanta:identity-change");
    assert.deepEqual(Object.keys(received[0]).sort(), [
      "reason",
      "timestamp",
      "type",
    ]);
  } finally {
    otherTab.close();
    unsubscribe();
  }
});

test("delivers concurrent account-change signals without losing either", async () => {
  const received: IdentityMessage[] = [];
  const unsubscribe = subscribeToIdentityChanges((message) => {
    received.push(message);
  });

  const otherTab = new BroadcastChannel(IDENTITY_CHANNEL_NAME);
  try {
    otherTab.postMessage({
      type: "livanta:identity-change",
      reason: "switch",
      timestamp: 1,
      id: "sig-concurrent-a",
    });
    otherTab.postMessage({
      type: "livanta:identity-change",
      reason: "sign-out",
      timestamp: 2,
      id: "sig-concurrent-b",
    });

    await waitFor(() => received.length === 2);
    assert.deepEqual(
      received.map((message) => message.reason),
      ["switch", "sign-out"],
    );
  } finally {
    otherTab.close();
    unsubscribe();
  }
});

test("deduplicates the same signal delivered over both transports", async () => {
  const fake = fakeStorage();
  setIdentityStorageForTesting(fake.port);
  setIdentityTransportForTesting(null);

  const received: IdentityMessage[] = [];
  const unsubscribe = subscribeToIdentityChanges((message) => {
    received.push(message);
  });

  try {
    received.length = 0;
    fake.emitFromOtherTab(IDENTITY_STORAGE_KEY, "sig-duplicate");
    fake.emitFromOtherTab(IDENTITY_STORAGE_KEY, "sig-duplicate");

    assert.equal(received.length, 1, "the same signal id is delivered once");
  } finally {
    unsubscribe();
    setIdentityStorageForTesting(null);
  }
});

test("falls back to storage events when BroadcastChannel is unavailable", () => {
  const fake = fakeStorage();
  setIdentityStorageForTesting(fake.port);
  setIdentityTransportForTesting({ broadcast: false, storage: true });

  assert.equal(identityTransportKind(), "storage");

  const received: IdentityMessage[] = [];
  const unsubscribe = subscribeToIdentityChanges((message) => {
    received.push(message);
  });

  try {
    fake.emitFromOtherTab("unrelated-key", "sig-ignored");
    assert.equal(received.length, 0, "unrelated storage keys are ignored");

    fake.emitFromOtherTab(IDENTITY_STORAGE_KEY, "sig-storage-1");
    assert.equal(received.length, 1);
    assert.equal(received[0].reason, "switch");
  } finally {
    unsubscribe();
  }
});

test("sends an opaque storage nonce when BroadcastChannel is unavailable", () => {
  const fake = fakeStorage();
  setIdentityStorageForTesting(fake.port);
  setIdentityTransportForTesting({ broadcast: false, storage: true });

  broadcastIdentityChange("sign-out");

  const signals = fake.writes.filter(
    ([key]) => key === IDENTITY_STORAGE_KEY,
  );
  assert.equal(signals.length, 1, "the fallback writes exactly one signal");
  const [, value] = signals[0];
  assert.match(value, /^sig-[0-9a-f]+|^sig-[a-z0-9]+$/);
  assert.ok(
    !/00000000-0000-0000|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(value),
    "the nonce is not shaped like an account id",
  );
  assert.ok(!value.includes("@"), "no email address in the signal");
  assert.ok(!value.includes("token"), "no token in the signal");
});

test("fails closed when neither transport is available", () => {
  setIdentityTransportForTesting({ broadcast: false, storage: false });

  assert.equal(identityTransportKind(), "unavailable");
  assert.throws(
    () => broadcastIdentityChange("sign-out"),
    /No cross-tab transport could deliver/,
  );
});

test("falls back to storage when a BroadcastChannel send throws", () => {
  const originalChannel = globals.BroadcastChannel;
  class ThrowingChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(name: string) {
      void name;
    }
    postMessage() {
      throw new Error("channel closed");
    }
    close() {}
  }
  define("BroadcastChannel", ThrowingChannel);

  const fake = fakeStorage();
  setIdentityStorageForTesting(fake.port);
  setIdentityTransportForTesting(null);

  try {
    assert.equal(identityTransportKind(), "broadcast");
    broadcastIdentityChange("switch");
    assert.equal(
      fake.writes.filter(([key]) => key === IDENTITY_STORAGE_KEY).length,
      1,
      "storage accepted the signal after the channel threw",
    );

    // With the fallback disabled as well, the failure is reported rather than
    // swallowed.
    setIdentityTransportForTesting({ broadcast: true, storage: false });
    assert.throws(
      () => broadcastIdentityChange("switch"),
      /No cross-tab transport could deliver/,
    );
  } finally {
    define("BroadcastChannel", originalChannel);
    setIdentityStorageForTesting(null);
    setIdentityTransportForTesting(null);
  }
});

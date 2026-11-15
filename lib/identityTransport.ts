/**
 * Cross-tab identity signalling (ADR 0002 §5.3, D5).
 *
 * A signal says only that the session may have changed. It never carries an
 * account id, token or any other identity: the receiving tab re-reads the
 * authoritative session and decides for itself. That is what makes the payload
 * safe to broadcast to every same-origin tab.
 *
 * BroadcastChannel is the primary transport. A write to a dedicated,
 * non-secret localStorage key raises a `storage` event in other tabs and is
 * used when BroadcastChannel is unavailable or a send fails. Both are written
 * when both are usable; the opaque signal id deduplicates the two deliveries.
 * At least one transport must be usable before an account store may open
 * (`identityTransportKind`), and a send that no transport accepted throws, so a
 * transition cannot report success when no other tab was told.
 *
 * `storage` events are delivered to other documents, not the writer, so a tab
 * never receives its own signal. Keep that property in tests: the storage port
 * exposes reads/writes and listener registration, not a self-dispatch helper.
 */

export type IdentityReason = "sign-out" | "switch";

export interface IdentityMessage {
  readonly type: "livanta:identity-change";
  readonly reason: IdentityReason;
  readonly timestamp: number;
}

export type IdentityTransportKind = "broadcast" | "storage" | "unavailable";

export class IdentityTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityTransportError";
  }
}

const SIGNAL_TYPE = "livanta:identity-change" as const;

/** ADR 0002 §5.3 names one key for both transports. */
export const IDENTITY_CHANNEL_NAME = "livanta.identity.v1";
export const IDENTITY_STORAGE_KEY = "livanta.identity.v1";

const PROBE_KEY = "livanta.identity.probe.v1";
const SEEN_LIMIT = 64;

export interface IdentityStorageEvent {
  readonly key: string | null;
  readonly newValue?: string | null;
}

/** The minimum storage surface, so tests can supply another tab's device. */
export interface IdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  addEventListener(
    type: "storage",
    listener: (event: IdentityStorageEvent) => void,
  ): void;
  removeEventListener(
    type: "storage",
    listener: (event: IdentityStorageEvent) => void,
  ): void;
}

interface TransportOverride {
  readonly broadcast: boolean;
  readonly storage: boolean;
}

let transportOverride: TransportOverride | null = null;
let storageOverride: IdentityStorage | null = null;
let broadcastProbe: boolean | null = null;
let storageProbe: boolean | null = null;

let channel: BroadcastChannel | null = null;
let boundStorage: IdentityStorage | null = null;
let storageListener: ((event: IdentityStorageEvent) => void) | null = null;

const listeners = new Set<(message: IdentityMessage) => void>();
let seen = new Set<string>();

function browserStorage(): IdentityStorage | null {
  if (storageOverride) return storageOverride;
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    if (!storage || typeof window.addEventListener !== "function") return null;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        storage.setItem(key, value);
      },
      removeItem: (key) => {
        storage.removeItem(key);
      },
      addEventListener: (type, listener) => {
        window.addEventListener(
          type,
          listener as unknown as EventListener,
        );
      },
      removeEventListener: (type, listener) => {
        window.removeEventListener(
          type,
          listener as unknown as EventListener,
        );
      },
    };
  } catch {
    return null;
  }
}

function canUseBroadcast(): boolean {
  const allowed = transportOverride ? transportOverride.broadcast : true;
  if (!allowed || typeof BroadcastChannel === "undefined") return false;
  if (broadcastProbe !== null) return broadcastProbe;
  try {
    const probe = new BroadcastChannel(IDENTITY_CHANNEL_NAME);
    probe.close();
    return (broadcastProbe = true);
  } catch {
    return (broadcastProbe = false);
  }
}

function canUseStorage(): boolean {
  if (transportOverride && !transportOverride.storage) return false;
  if (storageProbe !== null) return storageProbe;

  const storage = browserStorage();
  if (!storage) return (storageProbe = false);

  // A read-only or disabled localStorage would accept nothing and deliver
  // nothing. Prove a round trip before treating it as a transport.
  try {
    storage.setItem(PROBE_KEY, "1");
    const roundTrip = storage.getItem(PROBE_KEY) === "1";
    storage.removeItem(PROBE_KEY);
    return (storageProbe = roundTrip);
  } catch {
    return (storageProbe = false);
  }
}

/** Whether this tab can tell other tabs about an identity change at all. */
export function identityTransportKind(): IdentityTransportKind {
  if (canUseBroadcast()) return "broadcast";
  if (canUseStorage()) return "storage";
  return "unavailable";
}

function remember(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > SEEN_LIMIT) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return true;
}

function receive(reason: IdentityReason, id: string | null): void {
  if (id !== null && !remember(id)) return;
  const message: IdentityMessage = {
    type: SIGNAL_TYPE,
    reason,
    timestamp: Date.now(),
  };
  for (const listener of [...listeners]) listener(message);
}

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (!canUseBroadcast()) return null;
  try {
    channel = new BroadcastChannel(IDENTITY_CHANNEL_NAME);
    channel.onmessage = (event) => {
      const data = event.data as {
        type?: unknown;
        reason?: unknown;
        id?: unknown;
      } | null;
      if (!data || data.type !== SIGNAL_TYPE) return;
      const reason: IdentityReason =
        data.reason === "sign-out" ? "sign-out" : "switch";
      receive(reason, typeof data.id === "string" ? data.id : null);
    };
  } catch {
    channel = null;
  }
  return channel;
}

function ensureStorageListener(): void {
  if (storageListener) return;
  if (!canUseStorage()) return;

  const storage = browserStorage();
  if (!storage) return;

  const listener = (event: IdentityStorageEvent) => {
    if (event.key !== IDENTITY_STORAGE_KEY) return;
    // The value is only an opaque nonce; the reason is not part of the signal.
    receive("switch", event.newValue ?? null);
  };
  storage.addEventListener("storage", listener);
  storageListener = listener;
  boundStorage = storage;
}

function ensureTransport(): void {
  ensureChannel();
  ensureStorageListener();
}

function closeTransport(): void {
  if (channel) {
    channel.close();
    channel = null;
  }
  if (storageListener && boundStorage) {
    boundStorage.removeEventListener("storage", storageListener);
  }
  storageListener = null;
  boundStorage = null;
}

function newSignalId(): string {
  try {
    const crypto = globalThis.crypto;
    if (typeof crypto?.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      let value = "";
      for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
      return `sig-${value}`;
    }
  } catch {
    // Fall through to a non-identity random value.
  }
  return `sig-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function subscribeToIdentityChanges(
  listener: (message: IdentityMessage) => void,
): () => void {
  listeners.add(listener);
  ensureTransport();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) closeTransport();
  };
}

/**
 * Tells every other tab that the session may have changed.
 *
 * Throws when no transport accepted the signal, so the caller can keep the app
 * blocked instead of reporting a transition that no other tab knows about.
 */
export function broadcastIdentityChange(reason: IdentityReason): void {
  const id = newSignalId();
  let delivered = false;

  if (canUseBroadcast()) {
    const ch = ensureChannel();
    if (ch) {
      try {
        ch.postMessage({
          type: SIGNAL_TYPE,
          reason,
          timestamp: Date.now(),
          id,
        });
        delivered = true;
      } catch {
        // Fall through to the storage transport.
      }
    }
  }

  if (canUseStorage()) {
    const storage = browserStorage();
    if (storage) {
      try {
        storage.setItem(IDENTITY_STORAGE_KEY, id);
        delivered = true;
      } catch {
        // No transport accepted the signal.
      }
    }
  }

  if (!delivered) {
    throw new IdentityTransportError(
      "No cross-tab transport could deliver the identity change.",
    );
  }
}

/** Closes the active transport and clears capability probes, for tests. */
export function resetIdentityTransportForTesting(): void {
  closeTransport();
  seen = new Set();
  broadcastProbe = null;
  storageProbe = null;
}

/** Forces transport availability for tests. Pass null for real detection. */
export function setIdentityTransportForTesting(
  override: TransportOverride | null,
): void {
  transportOverride = override;
  resetIdentityTransportForTesting();
}

/** Replaces device storage for tests. Pass null for real localStorage. */
export function setIdentityStorageForTesting(
  storage: IdentityStorage | null,
): void {
  storageOverride = storage;
  resetIdentityTransportForTesting();
}

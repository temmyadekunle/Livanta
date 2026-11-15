/**
 * The persisted reminder-ownership marker (ADR 0002 §5.3).
 *
 * Native reminders fire with the app closed, so the app cannot ask React state
 * which account scheduled them. The device therefore keeps one small marker:
 * it records who last completed a reminder transition, in which phase, at which
 * epoch and under which random transition id.
 *
 * The marker is deliberately opaque. `owner` is a device-salted HMAC of the
 * account id, never the id itself, and the record contains no email, name,
 * token, record id, count or reminder text. The salt is non-secret but is
 * stored separately so the marker cannot be correlated across devices.
 *
 * An absent or corrupt marker is not trusted: callers must run the recovery
 * transition (cancel everything, then write `active`) before activating an
 * account. Unreadable storage is an error rather than "absent" because a
 * device that cannot persist ownership cannot prove its reminder state.
 */

export const OWNER_MARKER_KEY = "livanta.reminder-owner.v2";
export const OWNER_SALT_KEY = "livanta.install-salt.v1";

const MARKER_VERSION = 2;
const DOMAIN = "livanta:reminder-owner:v2:";
const SALT_BYTES = 32;
const OWNER_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export type ReminderPhase = "transitioning" | "active";

export interface ReminderMarker {
  readonly v: 2;
  readonly phase: ReminderPhase;
  /** Salted owner hash, or null when no account owns the reminders. */
  readonly owner: string | null;
  readonly epoch: number;
  readonly tid: string;
  readonly at: number;
}

export class ReminderOwnerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReminderOwnerUnavailableError";
  }
}

/** The marker changed between the transition write and its completion. */
export class ReminderMarkerChangedError extends Error {
  constructor() {
    super("The reminder owner marker changed during the transition.");
    this.name = "ReminderMarkerChangedError";
  }
}

/** The minimum storage surface, so tests can supply an in-memory device. */
export interface ReminderOwnerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let storageOverride: ReminderOwnerStorage | null = null;

/** Replaces device storage for tests. Pass null to restore `localStorage`. */
export function setReminderOwnerStorageForTesting(
  storage: ReminderOwnerStorage | null,
): void {
  storageOverride = storage;
}

function deviceStorage(): ReminderOwnerStorage {
  if (storageOverride) return storageOverride;
  if (typeof window === "undefined") {
    throw new ReminderOwnerUnavailableError(
      "Device storage is unavailable outside a browser.",
    );
  }
  try {
    return window.localStorage;
  } catch {
    throw new ReminderOwnerUnavailableError("Device storage is unavailable.");
  }
}

function readItem(key: string): string | null {
  try {
    return deviceStorage().getItem(key);
  } catch (error) {
    if (error instanceof ReminderOwnerUnavailableError) throw error;
    throw new ReminderOwnerUnavailableError(
      "The reminder owner could not be read from this device.",
    );
  }
}

function writeItem(key: string, value: string): void {
  try {
    deviceStorage().setItem(key, value);
  } catch (error) {
    if (error instanceof ReminderOwnerUnavailableError) throw error;
    throw new ReminderOwnerUnavailableError(
      "The reminder owner could not be saved on this device.",
    );
  }
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function webCrypto(): Crypto {
  const value = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (
    !value ||
    typeof value.getRandomValues !== "function" ||
    !value.subtle
  ) {
    throw new ReminderOwnerUnavailableError(
      "This device cannot verify reminder ownership.",
    );
  }
  return value;
}

function loadSalt(): Uint8Array<ArrayBuffer> {
  const stored = readItem(OWNER_SALT_KEY);
  if (stored) {
    try {
      const salt = decode(stored);
      if (salt.length === SALT_BYTES) return salt;
    } catch {
      // A corrupt salt cannot reproduce the previous hashes, so it is replaced
      // and the next transition rewrites the marker for the current owner.
    }
  }

  const salt = webCrypto().getRandomValues(new Uint8Array(SALT_BYTES));
  writeItem(OWNER_SALT_KEY, encode(salt));
  return salt;
}

/** The device-stable, non-reversible owner hash for an account. */
export async function reminderOwnerHash(userId: string): Promise<string> {
  if (!userId) {
    throw new ReminderOwnerUnavailableError(
      "An owner hash requires an account id.",
    );
  }

  const crypto = webCrypto();
  const salt = loadSalt();

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      salt,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(DOMAIN + userId),
    );
    return encode(new Uint8Array(signature).slice(0, 16));
  } catch (error) {
    if (error instanceof ReminderOwnerUnavailableError) throw error;
    throw new ReminderOwnerUnavailableError(
      "This device cannot verify reminder ownership.",
    );
  }
}

function isSafeEpoch(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

/**
 * Reads the marker, or null when it is absent or structurally corrupt.
 * Corrupt is treated as absent so the caller runs the recovery transition; it
 * is never treated as proof of ownership.
 */
export function readReminderMarker(): ReminderMarker | null {
  const raw = readItem(OWNER_MARKER_KEY);
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const marker = value as Record<string, unknown>;
  if (marker.v !== MARKER_VERSION) return null;
  if (marker.phase !== "transitioning" && marker.phase !== "active") return null;
  if (
    marker.owner !== null &&
    (typeof marker.owner !== "string" || !OWNER_PATTERN.test(marker.owner))
  ) {
    return null;
  }
  if (!isSafeEpoch(marker.epoch)) return null;
  if (typeof marker.tid !== "string" || !TID_PATTERN.test(marker.tid)) {
    return null;
  }
  if (typeof marker.at !== "number" || !Number.isFinite(marker.at)) return null;

  return {
    v: 2,
    phase: marker.phase,
    owner: marker.owner as string | null,
    epoch: marker.epoch,
    tid: marker.tid,
    at: marker.at,
  };
}

function writeMarker(marker: ReminderMarker): void {
  writeItem(OWNER_MARKER_KEY, JSON.stringify(marker));
}

function newTransitionId(): string {
  const bytes = webCrypto().getRandomValues(new Uint8Array(16));
  return encode(bytes);
}

/**
 * Publishes `transitioning` before any native cancellation is attempted. If
 * the process dies, reloads or the cancellation fails, this phase is what makes
 * the next launch recover instead of activating over an unknown reminder state.
 */
export function beginReminderTransition(owner: string | null): ReminderMarker {
  if (owner !== null && !OWNER_PATTERN.test(owner)) {
    throw new ReminderOwnerUnavailableError("An invalid reminder owner was given.");
  }

  const previous = readReminderMarker();
  const marker: ReminderMarker = {
    v: 2,
    phase: "transitioning",
    owner,
    epoch: (previous?.epoch ?? 0) + 1,
    tid: newTransitionId(),
    at: Date.now(),
  };
  writeMarker(marker);
  return marker;
}

/**
 * Publishes `active` for the transition that wrote `marker`. Refuses when the
 * epoch or transition id moved, so a late completion cannot claim ownership on
 * behalf of a transition that no longer exists.
 */
export function completeReminderTransition(marker: ReminderMarker): void {
  const current = readReminderMarker();
  if (
    !current ||
    current.phase !== "transitioning" ||
    current.epoch !== marker.epoch ||
    current.tid !== marker.tid
  ) {
    throw new ReminderMarkerChangedError();
  }

  writeMarker({ ...marker, phase: "active", at: Date.now() });
}

/** Test seam: drops the storage override without touching the device. */
export function resetReminderOwnerForTesting(): void {
  storageOverride = null;
}

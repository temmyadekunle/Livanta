/**
 * The exclusive identity/reminder lock (ADR 0002 §5.2 step 3, §5.3).
 *
 * Session reads, marker writes, native cancellation, account activation and
 * scheduling all happen under this one Web Lock. It is mandatory: if Web Locks
 * are unavailable the operation aborts rather than proceeding uncoordinated,
 * and acquisition is bounded so a frozen tab cannot block transitions forever.
 *
 * The lock lives in its own module so the reminder coordinator can depend on it
 * without importing the identity transition it participates in.
 */

const LOCK_TIMEOUT_MS = 5000;

export const IDENTITY_LOCK_NAME = "livanta:identity-and-reminders:v1";

export class IdentityLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityLockError";
  }
}

export class IdentityLockTimeoutError extends IdentityLockError {
  constructor() {
    super("Identity transition lock acquisition timed out.");
    this.name = "IdentityLockTimeoutError";
  }
}

type LockManager = {
  request(
    name: string,
    options: { signal: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void>;
};

let lockManager: LockManager | null = null;

/**
 * Override the lock manager for testing. Pass null to restore the default
 * (navigator.locks).
 */
export function setLockManager(mgr: LockManager | null): void {
  lockManager = mgr;
}

function getLocks(): LockManager | null {
  if (lockManager !== null) return lockManager;
  return typeof navigator !== "undefined"
    ? (navigator as { locks?: LockManager }).locks ?? null
    : null;
}

/**
 * Acquires the Web Lock for the duration of `work` with a bounded wait, and
 * returns `work`'s result.
 *
 * Throws IdentityLockError if Web Locks are unavailable, or
 * IdentityLockTimeoutError if the lock cannot be acquired within the timeout.
 * The lock is released automatically when work completes. On timeout the
 * queued request is aborted and work never runs, so an operation can never
 * proceed as though it owns the lock.
 */
export async function withIdentityLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = getLocks();
  if (!locks) {
    throw new IdentityLockError(
      "Web Locks API unavailable; cannot coordinate identity transition.",
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCK_TIMEOUT_MS);
  const result: { value?: T } = {};

  try {
    await locks.request(IDENTITY_LOCK_NAME, { signal: controller.signal }, async () => {
      result.value = await work();
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new IdentityLockTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  return result.value as T;
}

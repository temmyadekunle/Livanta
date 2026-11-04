/**
 * A session read must never leave the app stuck on the splash screen. Supabase
 * normally answers `getSession()` immediately from local storage, but a storage
 * backend that never settles would otherwise keep the compulsory gate in
 * `loading` forever, with no retry and no route into the app.
 */

export const SESSION_TIMEOUT_MS = 10_000;

export class SessionTimeoutError extends Error {
  constructor() {
    super("Timed out reading the stored session.");
    this.name = "SessionTimeoutError";
  }
}

/**
 * Settles with `work`, or rejects with SessionTimeoutError after `ms`.
 *
 * A settlement that arrives after the timeout is consumed and discarded rather
 * than left unhandled. Callers additionally guard their state writes with an
 * attempt token, so a late response cannot overwrite a newer retry or an auth
 * event that arrived in the meantime.
 */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number = SESSION_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new SessionTimeoutError());
    }, ms);

    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Monotonic tokens for session reads. Every new read and every auth event
 * advances the counter, so an older read can tell that its answer is stale.
 */
export interface SessionAttempts {
  /** Starts a read and returns the token it must present when it settles. */
  begin(): number;
  /** True while `attempt` is still the newest read. */
  current(attempt: number): boolean;
  /** Discards every read in flight, without starting a new one. */
  invalidate(): void;
}

export function createSessionAttempts(): SessionAttempts {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      return latest;
    },
    current(attempt) {
      return attempt === latest;
    },
    invalidate() {
      latest += 1;
    },
  };
}

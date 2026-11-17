/**
 * Where an emailed authentication link must return.
 *
 * Every email flow passes this explicitly. Without it GoTrue falls back to the
 * project's Site URL, which is one dashboard value shared by every environment:
 * a development value there sends production sign-ups to a localhost address
 * the recipient cannot open, and the single-use token is spent on the way.
 *
 * The destination is chosen in this order:
 *
 * 1. `NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN`, when it is a valid HTTPS origin. This
 *    is how a staging or beta build names its canonical public host.
 * 2. The origin running the form, when it is localhost in a development build
 *    (the developer is deliberately testing locally) or any HTTPS host (the
 *    deployed site is reachable by the recipient by definition).
 * 3. The published Livanta origin, for a production build that is running on
 *    localhost or another insecure address. A production build must never put
 *    localhost in an email: the recipient's device cannot reach it.
 *
 * The pathname is preserved so the user lands back on the page that started
 * the flow. The app is a static export, so the redirect must land on a page
 * that exists rather than on a server route.
 */

/** The deployed app's origin: the same host the landing page publishes. */
export const PUBLISHED_AUTH_ORIGIN = "https://livanta.folababy02.workers.dev";

interface AuthRedirectEnvironment {
  /** A canonical HTTPS origin configured for this deployment. */
  readonly configuredOrigin?: string | null;
  /** Whether this is a production build rather than `next dev`. */
  readonly isProduction?: boolean;
  /** The publicly reachable origin used when the current one is not. */
  readonly publishedOrigin?: string;
}

let override: AuthRedirectEnvironment | null = null;

/**
 * Replaces the environment the resolver reads. Production code never calls
 * this; tests use it to simulate a production build served from localhost.
 */
export function setAuthRedirectEnvironmentForTesting(
  next: AuthRedirectEnvironment | null,
): void {
  override = next;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}

/** A configured origin is used only when it is a bare HTTPS origin. */
function configuredHttpsOrigin(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  if (isLocalHost(url.hostname)) return null;
  return url.origin;
}

function environment(): {
  configuredOrigin: string | null;
  isProduction: boolean;
  publishedOrigin: string;
} {
  const base = {
    configuredOrigin: process.env.NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN ?? null,
    isProduction: process.env.NODE_ENV === "production",
    publishedOrigin: PUBLISHED_AUTH_ORIGIN,
  };
  if (!override) return base;
  return {
    configuredOrigin:
      override.configuredOrigin === undefined
        ? base.configuredOrigin
        : override.configuredOrigin,
    isProduction:
      override.isProduction === undefined
        ? base.isProduction
        : override.isProduction,
    publishedOrigin: override.publishedOrigin ?? base.publishedOrigin,
  };
}

export function authRedirectUrl(origin: string, pathname: string): string {
  const env = environment();

  const configured = configuredHttpsOrigin(env.configuredOrigin);
  if (configured) return `${configured}${pathname}`;

  let current: URL;
  try {
    current = new URL(origin);
  } catch {
    return `${env.publishedOrigin}${pathname}`;
  }

  if (isLocalHost(current.hostname)) {
    return env.isProduction
      ? `${env.publishedOrigin}${pathname}`
      : `${current.origin}${pathname}`;
  }

  if (current.protocol === "https:") return `${current.origin}${pathname}`;

  return `${env.publishedOrigin}${pathname}`;
}

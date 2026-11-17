/**
 * Where an Android App Link is allowed to send the WebView.
 *
 * The app is loaded from `https://localhost` inside the WebView, so a URL can
 * never be loaded where it points. There are now two app-owned destinations:
 *
 * - `/auth/confirm/` carries the token hash Supabase emails. It is verified in
 *   place with `verifyOtp`; nothing from it is navigated to.
 * - The app root still carries the older implicit fragment (or GoTrue's failure
 *   fields), which is replayed onto the app's own root for supabase-js and the
 *   existing notice.
 *
 * This module is the gate in front of both. A link is accepted only when it is
 * an HTTPS URL on the published origin, at one of those paths, with fields the
 * corresponding flow can consume. Anything else — another host, a localhost
 * address, another path, a custom scheme, credentials, or an ambiguous mix — is
 * refused, and the caller does nothing.
 *
 * Only a fragment is returned for replay. The caller rebuilds the destination
 * from the app origin, so the raw link (and any token in it) never becomes a
 * navigation target and is never logged.
 */

import { parseAuthLinkError } from "./authLinkError.ts";
import { PUBLISHED_AUTH_ORIGIN } from "./authRedirect.ts";
import {
  AUTH_CONFIRM_PATH,
  isConfirmationAppLink,
  parseTokenHashAppLink,
  type TokenHashLink,
} from "./authTokenHash.ts";

/** The fragment types the web bootstrap acts on. */
const SESSION_TYPES = new Set(["signup", "recovery"]);

/** The two fields supabase-js needs to exchange an implicit-grant fragment. */
const SESSION_FIELDS = ["access_token", "refresh_token"] as const;

/** Paths whose fragment the existing web bootstrap can consume at the root. */
const FRAGMENT_PATHS = new Set(["/", AUTH_CONFIRM_PATH]);

function sessionFragment(params: URLSearchParams): boolean {
  if (params.has("error") || params.has("error_code")) return false;
  const type = params.get("type");
  if (type === null || !SESSION_TYPES.has(type)) return false;
  return SESSION_FIELDS.every((field) => Boolean(params.get(field)));
}

/**
 * The fragment of a link the app may replay, or null when the link is not an
 * authentication link for this app.
 */
export function nativeAuthLinkFragment(
  raw: string | null | undefined,
  publishedOrigin: string = PUBLISHED_AUTH_ORIGIN,
): string | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.origin !== publishedOrigin) return null;
  if (url.username || url.password) return null;
  if (!FRAGMENT_PATHS.has(url.pathname)) return null;
  if (url.search) return null;
  if (!url.hash || url.hash === "#") return null;

  const fragment = url.hash.slice(1);
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(fragment);
  } catch {
    return null;
  }

  // A failure link carries no tokens; parseAuthLinkError refuses one that does.
  if (parseAuthLinkError(url.hash) !== null) return url.hash;
  if (!sessionFragment(params)) return null;

  return url.hash;
}

/** A token-hash App Link the app may verify in place, or null. */
export function nativeTokenHashLink(
  raw: string | null | undefined,
  publishedOrigin: string = PUBLISHED_AUTH_ORIGIN,
): TokenHashLink | null {
  return parseTokenHashAppLink(raw, publishedOrigin);
}

/**
 * Whether a link is on this app's confirmation path, even when its token fields
 * are malformed. Used only to replace a silent no-op with an explanation.
 */
export function isNativeAuthConfirmLink(
  raw: string | null | undefined,
  publishedOrigin: string = PUBLISHED_AUTH_ORIGIN,
): boolean {
  return isConfirmationAppLink(raw, publishedOrigin);
}

/**
 * The same-origin destination to load, built from the app's own root. The
 * caller supplies only a fragment already accepted by this module.
 */
export function nativeAuthLinkDestination(fragment: string): string {
  const hash = fragment.startsWith("#") ? fragment : `#${fragment}`;
  return `/${hash}`;
}

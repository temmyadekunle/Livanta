/**
 * The token-hash links Supabase emails for sign-up confirmation and recovery.
 *
 * The default `{{ .ConfirmationURL }}` points at `<project>.supabase.co`, which
 * verifies the token and redirects to the app. Chrome does not hand a URL
 * reached through that server redirect to an Android App Link, so the app never
 * sees it. These links instead carry the hash straight to the app's own HTTPS
 * origin and the app exchanges it with `verifyOtp`.
 *
 * Two things matter at this boundary. The hash is a bearer credential, so it is
 * never logged or stored and is stripped from the address bar as soon as it has
 * been read. And the input is checked strictly before any network call: one
 * value, lowercase SHA-224 hex as GoTrue generates it, and one of the two types
 * this app can act on. Anything else is a malformed link, not a session.
 */

import type { AuthLinkError } from "./authLinkError.ts";

/** The static route the emailed links land on. */
export const AUTH_CONFIRM_PATH = "/auth/confirm/";

export type TokenHashType = "signup" | "recovery";

export interface TokenHashLink {
  readonly type: TokenHashType;
  readonly tokenHash: string;
}

/**
 * GoTrue hashes the OTP with SHA-224 and formats it with `%x`: exactly 56
 * lowercase hexadecimal characters. Pinning that shape rejects arbitrary
 * strings before they reach Supabase.
 */
const TOKEN_HASH_PATTERN = /^[0-9a-f]{56}$/;

const TOKEN_TYPES: readonly TokenHashType[] = ["signup", "recovery"];

/** Authentication fields removed from the URL once they have been read. */
const SENSITIVE_PARAMS = new Set([
  "token_hash",
  "type",
  "error",
  "error_code",
  "error_description",
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "provider_token",
  "provider_refresh_token",
]);

export function isTokenHashType(value: unknown): value is TokenHashType {
  return (
    typeof value === "string" &&
    (TOKEN_TYPES as readonly string[]).includes(value)
  );
}

/** A runtime check for values passed across a module boundary. */
export function isTokenHashLink(value: unknown): value is TokenHashLink {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { type?: unknown; tokenHash?: unknown };
  return (
    isTokenHashType(candidate.type) &&
    typeof candidate.tokenHash === "string" &&
    TOKEN_HASH_PATTERN.test(candidate.tokenHash)
  );
}

function paramsFrom(raw: string): URLSearchParams {
  return new URLSearchParams(raw.startsWith("#") || raw.startsWith("?") ? raw.slice(1) : raw);
}

function single(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

function linkFromParams(params: URLSearchParams): TokenHashLink | null {
  // A link that also carries a failure or a session is ambiguous and is not a
  // token-hash link, whatever else it contains.
  if (params.has("error") || params.has("error_code")) return null;
  if (params.has("access_token") || params.has("refresh_token")) return null;

  const tokenHash = single(params, "token_hash");
  const type = single(params, "type");
  if (!tokenHash || !TOKEN_HASH_PATTERN.test(tokenHash)) return null;
  if (!isTokenHashType(type)) return null;
  return { type, tokenHash };
}

/**
 * The token-hash link carried by a URL's query or fragment, or null. Supplying
 * both forms is refused rather than choosing one, so a link cannot smuggle a
 * second value past the check that was performed on the first.
 */
export function parseTokenHashLink(url: URL): TokenHashLink | null {
  const search = url.search.length > 1 ? paramsFrom(url.search) : null;
  const fragment = url.hash.length > 1 ? paramsFrom(url.hash) : null;

  const searchHasToken = search?.has("token_hash") ?? false;
  const fragmentHasToken = fragment?.has("token_hash") ?? false;
  if (searchHasToken && fragmentHasToken) return null;

  // The unused half of a link may not smuggle a session or failure beside the
  // token being checked.
  const conflicting = (params: URLSearchParams | null) =>
    params?.has("access_token") ||
    params?.has("refresh_token") ||
    params?.has("error") ||
    params?.has("error_code");

  if (search && searchHasToken) {
    if (conflicting(fragment)) return null;
    return linkFromParams(search);
  }
  if (fragment && fragmentHasToken) {
    if (conflicting(search)) return null;
    return linkFromParams(fragment);
  }
  return null;
}

/**
 * The parts of an App Link this module is willing to inspect: HTTPS on the
 * published origin, no credentials, and the dedicated confirmation path.
 */
function isPublishedConfirmationUrl(
  raw: string | null | undefined,
  publishedOrigin: string,
): URL | null {
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
  if (url.pathname !== AUTH_CONFIRM_PATH) return null;
  return url;
}

/** A token-hash App Link, or null when the URL is not one. */
export function parseTokenHashAppLink(
  raw: string | null | undefined,
  publishedOrigin: string,
): TokenHashLink | null {
  const url = isPublishedConfirmationUrl(raw, publishedOrigin);
  if (!url) return null;
  return parseTokenHashLink(url);
}

/**
 * Whether a URL is on the confirmation path this app owns, even if its token
 * fields are malformed. The native bridge uses this to explain a broken link
 * instead of silently opening the ordinary app.
 */
export function isConfirmationAppLink(
  raw: string | null | undefined,
  publishedOrigin: string,
): boolean {
  return isPublishedConfirmationUrl(raw, publishedOrigin) !== null;
}

function strip(
  raw: string,
  prefix: "" | "?" | "#",
  params: URLSearchParams,
): string {
  for (const name of SENSITIVE_PARAMS) params.delete(name);
  const text = params.toString();
  return text ? `${prefix}${text}` : "";
}

/**
 * A copy of `url` with authentication fields removed from both the query and
 * the fragment. Unrelated parameters are preserved; an empty `?` or `#` is
 * removed entirely. The original URL object is not touched.
 */
export function stripSensitiveAuthParams(url: URL): URL {
  const copy = new URL(url.toString());
  if (copy.search) {
    copy.search = strip(copy.search, "?", paramsFrom(copy.search));
  }
  if (copy.hash) {
    copy.hash = strip(copy.hash, "#", paramsFrom(copy.hash));
  }
  return copy;
}

/**
 * Whether a fragment belongs to the older implicit flow (or carries GoTrue's
 * failure fields) and must still be handed to supabase-js untouched. This looks
 * only at names, never at the values.
 */
export function hasImplicitOrErrorFragment(hash: string): boolean {
  if (!hash || hash === "#") return false;
  const params = paramsFrom(hash);
  return (
    params.has("access_token") ||
    params.has("refresh_token") ||
    params.has("error") ||
    params.has("error_code")
  );
}

/** Kept for callers that only need a failure label. */
export type EmailLinkFailure = AuthLinkError;

/** The path-and-hash destination that hands a legacy fragment to the app root. */
export function appRootWithFragment(hash: string): string {
  return hash && hash !== "#" ? `/${hash}` : "/";
}

/**
 * Errors GoTrue appends to the URL when an emailed link fails.
 *
 * The failed link is the only place the reason exists: supabase-js reads the
 * URL during initialisation but deliberately leaves an existing session in
 * place, and `getSession()` does not return that initialisation error. Without
 * this module a failed confirmation is silent, which is indistinguishable from
 * "the new account signed in" when another account was already signed in.
 *
 * Only the code is kept. `error_description` is untrusted text from the URL and
 * is never stored or rendered; no token is read here.
 */

export type AuthLinkError = "expired" | "invalid";

const EXPIRED_CODES = new Set(["otp_expired"]);

/** The fields supabase-js needs to exchange an implicit-grant fragment. */
const IMPLICIT_SESSION_FIELDS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "token_type",
] as const;

/**
 * The access token from a sign-up confirmation fragment, or null when the
 * fragment is not one.
 *
 * This is read before supabase-js touches the URL. The token is only compared
 * in memory with the session the client publishes; it is never stored, logged
 * or rendered. A fragment that also carries an error is not a confirmation,
 * whatever else it contains.
 */
export function parseConfirmationLinkAccessToken(hash: string): string | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) return null;

  const params = new URLSearchParams(fragment);
  if (params.has("error") || params.has("error_code")) return null;
  if (params.get("type") !== "signup") return null;
  if (!IMPLICIT_SESSION_FIELDS.every((field) => params.get(field))) return null;

  return params.get("access_token");
}

/**
 * Returns the link failure in `hash`, or null when it is absent or carries a
 * session. A fragment with tokens is left alone for the client's own URL
 * exchange, even if it also contains an error field.
 */
export function parseAuthLinkError(hash: string): AuthLinkError | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) return null;

  const params = new URLSearchParams(fragment);
  if (params.has("access_token") || params.has("refresh_token")) return null;

  const code = params.get("error_code");
  const error = params.get("error");
  if (!code && !error) return null;

  return code !== null && EXPIRED_CODES.has(code) ? "expired" : "invalid";
}

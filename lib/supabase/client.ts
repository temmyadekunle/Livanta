/**
 * Supabase access, kept deliberately optional.
 *
 * Livanta is local-first: everything works with no account and no network. If
 * these environment variables are absent the helpers here return null and every
 * caller falls back to IndexedDB, which is why importing this module must never
 * throw. That is what keeps the static build working unchanged for
 * users who never sign in.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { hasUsableCloudConfig } from "./config.ts";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export { hasUsableCloudConfig };

/** True when a project URL and anon key were provided at build time. */
export function isCloudEnabled(): boolean {
  return hasUsableCloudConfig(URL, ANON_KEY);
}

let cached: SupabaseClient | null = null;

/**
 * A client installed by tests, used instead of creating one from the build-time
 * credentials. Production code never calls the setter; `isCloudEnabled` still
 * reflects the real configuration, so a test opts into the cloud path by
 * providing credentials as well as a client.
 */
let override: SupabaseClient | null = null;

export function setSupabaseForTesting(client: SupabaseClient | null): void {
  override = client;
  cached = null;
}

/**
 * The shared client, or null when the app was built without cloud config.
 * Created on first use rather than at import time so nothing runs during the
 * static export and prerender pass.
 *
 * Deliberately untyped at the query level: the row shapes in ./types.ts are
 * hand-maintained, and mapping through them explicitly in sync/rows.ts keeps
 * the conversions checked without pretending to a generated Database type
 * that would silently drift from the SQL.
 */
export function getSupabase(): SupabaseClient | null {
  if (override) return override;
  if (!isCloudEnabled()) return null;
  if (cached) return cached;

  cached = createClient(URL!, ANON_KEY!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Must stay on. Supabase returns the emailed recovery link with the token
      // in the URL fragment, and this is the only thing that exchanges it for a
      // session and fires PASSWORD_RECOVERY. With it off, following a reset link
      // silently did nothing.
      detectSessionInUrl: true,
    },
  });

  return cached;
}

/** A client that is known to exist, for internals that already checked. */
export type Supabase = SupabaseClient;

/** Same as getSupabase, for call sites that cannot handle a null client. */
export function requireSupabase(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    throw new Error(
      "Cloud sync is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return client;
}
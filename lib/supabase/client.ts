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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function hasUsableCloudConfig(
  url: string | undefined,
  key: string | undefined,
): boolean {
  if (!url || !key) return false;
  const cleanUrl = url.trim();
  const cleanKey = key.trim();
  if (!/^https:\/\//i.test(cleanUrl)) return false;
  if (/^https:\/\/your/i.test(cleanUrl)) return false;
  if (/^your[-_]/i.test(cleanKey)) return false;
  return true;
}

/** True when a project URL and anon key were provided at build time. */
export function isCloudEnabled(): boolean {
  return hasUsableCloudConfig(URL, ANON_KEY);
}

let cached: SupabaseClient | null = null;

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
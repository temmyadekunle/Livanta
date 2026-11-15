/**
 * The authoritative session read.
 *
 * Reminder ownership is decided from a fresh session read, never from React
 * state or from a message another tab sent. This module is the one place that
 * performs that read, so the auth store, the reminder transition and the
 * reminder coordinator all agree on what "the current owner" means.
 *
 * A missing client or a failed read throws: callers must treat that as
 * "unresolved", not as signed out.
 */

import { getSupabase } from "./supabase/client.ts";
import { withTimeout } from "./sessionTimeout.ts";

/**
 * Returns the normalized owner id of the persisted session, or null when the
 * authority definitively says there is no session.
 *
 * Throws when the authority is unavailable, the read fails, or it does not
 * answer within the bounded wait.
 */
export async function readSessionOwner(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("The session authority is unavailable.");
  const { data, error } = await withTimeout(supabase.auth.getSession());
  if (error) throw error;
  return data.session?.user.id ?? null;
}

/**
 * Signing out is a network call with local consequences, so it gets its own
 * small boundary: a rejected request must become a visible failure rather than
 * an unhandled rejection, and the caller must not clear its session flags until
 * the sign-out actually succeeded.
 */

export interface SignOutClient {
  auth: {
    signOut: () => Promise<{ error: { message: string } | null }>;
  };
}

export type SignOutResult =
  | { ok: true }
  | { ok: false; message: string };

export async function performSignOut(
  client: SignOutClient | null,
): Promise<SignOutResult> {
  if (!client) {
    return { ok: false, message: "Cloud authentication is not configured." };
  }

  try {
    const { error } = await client.auth.signOut();
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Sign out failed.",
    };
  }
}

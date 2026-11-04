/**
 * Decides which surface the app is allowed to render.
 *
 * This is a single, pure decision rather than a set of flags spread across the
 * component, because compulsory authentication is only as strong as its
 * weakest branch. The rules are deliberately narrow:
 *
 * - Auth state is checked before anything else, so a signed-out or unresolved
 *   session never reaches onboarding, the demo, or the dashboard.
 * - Onboarding state cannot hide the gate. A device can be fully onboarded and
 *   still be signed out; that is exactly the state the gate exists for.
 * - There is no dismissal input. A previous version stored a permanent
 *   `livanta.authGate.dismissed.v1` latch in local storage; that key is left
 *   untouched on existing devices but is never read again, so it cannot
 *   disable authentication. Nothing here deletes local data.
 * - A failed session read is an error surface, not a signed-out one and not a
 *   dashboard. The only way out is an explicit retry.
 *
 * The retired dismissal key is intentionally not cleaned up. It is not user
 * data, but removing it would be an unrequested write to a device's storage on
 * the next load for no functional gain.
 */

import type { AuthStatus } from "./useAuth.ts";

export type AppSurface =
  | { readonly kind: "booting" }
  | { readonly kind: "auth-loading" }
  | { readonly kind: "auth-error" }
  | { readonly kind: "auth-gate" }
  | { readonly kind: "recovery" }
  | { readonly kind: "onboarding" }
  | { readonly kind: "app" };

export interface AppSurfaceInput {
  /** The local desk has finished its first read. */
  ready: boolean;
  onboarded: boolean;
  /** Whether this build has cloud authentication configured. */
  authEnabled: boolean;
  authStatus: AuthStatus;
  /** True once a recovery link has established the reset session. */
  passwordResetReady: boolean;
}

export function resolveAppSurface(input: AppSurfaceInput): AppSurface {
  if (input.authEnabled) {
    switch (input.authStatus) {
      case "loading":
        return { kind: "auth-loading" };
      case "error":
        // Also reached through the default branch below. Named explicitly so
        // the fail-closed intent is visible.
        return { kind: "auth-error" };
      case "disabled":
        // Contradictory: auth is configured but reports itself disabled.
        // Never fall through to the app on an inconsistent state.
        return { kind: "auth-error" };
      case "signed-out":
        return input.passwordResetReady
          ? { kind: "recovery" }
          : { kind: "auth-gate" };
      case "signed-in":
        break;
      default:
        return { kind: "auth-error" };
    }

    // A recovery link signs the user in, so this has to win over the ordinary
    // signed-in path; otherwise the new-password form is unreachable.
    if (input.passwordResetReady) return { kind: "recovery" };
  }

  if (!input.ready) return { kind: "booting" };
  if (!input.onboarded) return { kind: "onboarding" };
  return { kind: "app" };
}

/**
 * True for every surface that exists only to establish or repair a session.
 * The Android back handler consults this: leaving one of these surfaces would
 * be a dismissal of compulsory authentication, so back does nothing there.
 */
export function isAuthSurface(surface: AppSurface): boolean {
  return (
    surface.kind === "auth-loading" ||
    surface.kind === "auth-error" ||
    surface.kind === "auth-gate" ||
    surface.kind === "recovery"
  );
}

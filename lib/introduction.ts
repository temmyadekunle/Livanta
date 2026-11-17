/**
 * When the introduction is shown.
 *
 * It is mandatory on every launch, so this no longer consults device storage.
 * The previous build recorded completion in `livanta.intro.v1` and skipped the
 * introduction for a signed-out device that had seen it; that marker is no
 * longer read or written, so every device sees the introduction again. The key
 * itself is deliberately left on disk untouched — it is not user data, and
 * deleting it would be an unrequested write.
 *
 * Auth-disabled builds keep their existing offline onboarding flow rather than
 * this pre-auth introduction.
 */

export interface IntroductionGateInput {
  readonly authEnabled: boolean;
}

export function shouldShowIntroduction(input: IntroductionGateInput): boolean {
  return input.authEnabled;
}

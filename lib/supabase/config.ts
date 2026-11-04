/**
 * Build-time validation for the cloud authentication configuration.
 *
 * Authentication is compulsory in this app, so a production build without
 * credentials would silently drop back to the local-only experience. That is
 * not a harmless omission: the gate would disappear from a shipped build
 * without anyone noticing. `next.config.ts` therefore fails the build unless a
 * usable URL and anon key are present.
 *
 * Development and tests are deliberately exempt: a contributor without
 * credentials still needs `next dev` and the test suite to work.
 */

/** True when the pair looks like a real Supabase project rather than a placeholder. */
export function hasUsableCloudConfig(
  url: string | undefined,
  key: string | undefined,
): boolean {
  const cleanUrl = url?.trim();
  const cleanKey = key?.trim();
  if (!cleanUrl || !cleanKey) return false;

  if (/^https:\/\/your/i.test(cleanUrl)) return false;
  if (/^your[-_]/i.test(cleanKey)) return false;

  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  if (!parsed.hostname) return false;
  return true;
}

/**
 * Throws when a production build has no usable authentication configuration.
 * `nodeEnv` is passed in rather than read here so the check is testable and
 * does not depend on when the caller loads environment files.
 */
export function assertProductionAuthConfig(
  url: string | undefined,
  key: string | undefined,
  nodeEnv: string | undefined,
): void {
  if (nodeEnv !== "production") return;
  if (hasUsableCloudConfig(url, key)) return;

  throw new Error(
    "Livanta requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "for production builds. Authentication is compulsory, so a production " +
      "build must not ship with cloud auth disabled. Copy .env.example to " +
      ".env.local and set both values.",
  );
}

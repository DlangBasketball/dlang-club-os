/**
 * Platform (master) brand. The product name is configuration, not code:
 * set NEXT_PUBLIC_PLATFORM_NAME per deployment. The fallback is a neutral,
 * descriptive label so no trademark candidate is ever hard-coded.
 *
 * Clubs never see this where they have their own name: each tenant shows its
 * own app display name (see src/lib/tenant/app-name.ts).
 * Safe in client and server code (NEXT_PUBLIC_* only).
 */
export const DEFAULT_PLATFORM_NAME = "Club OS";

/** Resolve the platform name from an env value (pure, for tests). */
export function platformNameFrom(value: string | undefined | null): string {
  const v = typeof value === "string" ? value.replace(/["<>\r\n]/g, "").trim() : "";
  return v || DEFAULT_PLATFORM_NAME;
}

export const PLATFORM_NAME = platformNameFrom(process.env.NEXT_PUBLIC_PLATFORM_NAME);

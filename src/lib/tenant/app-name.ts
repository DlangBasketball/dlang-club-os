import { PLATFORM_NAME } from "@/lib/brand";

/**
 * Per-club product name ("DLang OS"), stored in organizations.branding.app_name.
 * Same rules as public.validate_tenant_branding(): plain text, at most 60
 * characters, no markup/template characters and no control characters.
 * Empty / missing falls back to the organization name.
 */
export const APP_NAME_MAX = 60;

const FORBIDDEN = /[<>{}"`\\]/;
// eslint-disable-next-line no-control-regex -- deliberately matches control characters
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Normalised app name, or null when empty or invalid. */
export function sanitizeAppName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (CONTROL.test(value)) return null;
  const v = value.replace(/\s+/g, " ").trim();
  if (!v || v.length > APP_NAME_MAX || FORBIDDEN.test(v)) return null;
  return v;
}

/** Why an admin-entered value is refused (null = acceptable, "" means reset). */
export function appNameError(value: string): "tooLong" | "invalidChars" | null {
  if (CONTROL.test(value)) return "invalidChars";
  const v = value.replace(/\s+/g, " ").trim();
  if (!v) return null;
  if (v.length > APP_NAME_MAX) return "tooLong";
  if (FORBIDDEN.test(v)) return "invalidChars";
  return null;
}

/** The stored override inside a branding jsonb object, if any. */
export function appNameFromBranding(branding: unknown): string | null {
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) return null;
  return sanitizeAppName((branding as Record<string, unknown>).app_name);
}

/** Name the club sees: override -> organization name -> platform name. */
export function resolveAppName(orgName: string | null | undefined, branding: unknown): string {
  return appNameFromBranding(branding) ?? (orgName?.trim() || PLATFORM_NAME);
}

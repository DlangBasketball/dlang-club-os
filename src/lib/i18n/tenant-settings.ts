/**
 * Tenant language settings: parsing of the stored rows (pure, testable) and
 * the shape the admin "Languages" page edits.
 *
 * Storage (no new tables):
 *   organizations.default_locale / supported_locales   (typed, BCP 47 tags)
 *   app_settings.default_locale / enabled_locales      (typed mirror)
 *   app_settings.settings.languages                    (legacy mirror, read first)
 *   app_settings.settings.localization.regions         { "<lang>": "<REGION>" }
 */
import { allowedLocales } from "./negotiate";
import type { Locale } from "./languages";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export type TenantLocaleSettings = {
  orgId: string;
  country: string | null;
  currency: string | null;
  defaultLocale: string | null;
  timeZone: string | null;
  /** Enabled UI languages that have a catalog; null = not configured. */
  languages: Locale[] | null;
  /** Per-language formatting region, e.g. { en: "CH", de: "CH" }. */
  regions: Record<string, string>;
};

const REGION = /^([A-Za-z]{2}|[0-9]{3})$/;

export function parseRegions(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Row)) {
    if (typeof v === "string" && REGION.test(v)) out[k] = v.toUpperCase();
  }
  return out;
}

export function tenantLocaleSettingsFromRows(orgId: string, org: Row | null, settings: Row | null): TenantLocaleSettings {
  const o = org ?? {};
  const s = settings ?? {};
  const json = (s.settings && typeof s.settings === "object" ? s.settings : {}) as Row;
  const loc = (json.localization && typeof json.localization === "object" ? json.localization : {}) as Row;
  const rawLangs = Array.isArray(json.languages)
    ? json.languages
    : Array.isArray(s.enabled_locales)
      ? s.enabled_locales
      : Array.isArray(loc.languages)
        ? loc.languages
        : Array.isArray(o.supported_locales)
          ? o.supported_locales
          : null;
  const languages = rawLangs ? allowedLocales(rawLangs.map((l) => String(l))) : null;
  return {
    orgId,
    country: str(o.country),
    currency: str(s.currency) ?? str(o.currency),
    defaultLocale: str(s.default_locale) ?? str(o.default_locale),
    timeZone: str(s.timezone) ?? str(o.timezone) ?? str(json.timezone) ?? str(loc.timezone),
    languages,
    regions: parseRegions(loc.regions),
  };
}

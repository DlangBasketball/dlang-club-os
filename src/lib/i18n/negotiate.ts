import { DEFAULT_LOCALE, SOURCE_LOCALE, baseLanguage, canonicalizeTag, fallbackChain, matchLocale, type Locale } from "./config";

/** Accept-Language entries, best first ("*" and q=0 dropped). */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((x) => x.tag);
}

/**
 * Best allowed language for one requested tag, using the registry fallback
 * chains:
 *   1. exact match              fr-CH -> fr-CH
 *   2. along the fallback chain de-CH -> de      (de-AT -> de, zh-Hant-TW -> zh-Hant -> zh)
 *   3. same language, any region de -> de-CH     (tenant enabled only the variant)
 * English is only reached when English was asked for, so a Portuguese browser
 * falls through to the next Accept-Language entry instead of landing on "en".
 * `allowed` null = every language with a catalog.
 */
export function pickLocale(tag: string | null | undefined, allowed: readonly Locale[] | null): Locale | null {
  const c = canonicalizeTag(tag);
  if (!c) return null;
  if (!allowed) return matchLocale(c);
  const exact = allowed.find((a) => a.toLowerCase() === c.toLowerCase());
  if (exact) return exact;
  const wantsEnglish = baseLanguage(c) === SOURCE_LOCALE;
  for (const t of fallbackChain(c)) {
    if (t === SOURCE_LOCALE && !wantsEnglish) break;
    const hit = allowed.find((a) => a === t);
    if (hit) return hit;
  }
  const lang = baseLanguage(c);
  return allowed.find((a) => baseLanguage(a) === lang) ?? null;
}

/**
 * Parse an Accept-Language header and return the best supported locale.
 *   "de-CH,de;q=0.9,en;q=0.8"             -> "de-CH" (or "de" when only "de" is allowed)
 *   "pt-BR,pt;q=0.9"                      -> null (no Portuguese catalog yet)
 *   "pt-BR,pt;q=0.9,fr;q=0.5", [de, fr]   -> "fr"
 */
export function matchAcceptLanguage(header: string | null | undefined, allowed: readonly Locale[] | null = null): Locale | null {
  for (const tag of parseAcceptLanguage(header)) {
    const hit = pickLocale(tag, allowed);
    if (hit) return hit;
  }
  return null;
}

export type LocaleSources = {
  /** Explicit choice stored on the user's profile (profiles.locale with locale_set_at). */
  userPreference?: string | null;
  /** Explicit choice stored in the locale cookie (works signed-out too). */
  cookie?: string | null;
  /** Tenant default (app_settings.default_locale / organizations.default_locale). */
  tenantDefault?: string | null;
  /** Tenant's enabled languages; when set, only these are allowed. */
  tenantLanguages?: readonly string[] | null;
  /** Raw Accept-Language header. */
  acceptLanguage?: string | null;
};

/** Tenant's enabled languages that have a catalog (deduplicated, order kept); null = no restriction. */
export function allowedLocales(tenantLanguages: readonly string[] | null | undefined): Locale[] | null {
  const out: Locale[] = [];
  for (const l of tenantLanguages ?? []) {
    const m = matchLocale(l);
    if (m && !out.includes(m)) out.push(m);
  }
  return out.length ? out : null;
}

/**
 * Locale negotiation:
 *   user preference -> locale cookie -> Accept-Language (best match through
 *   the fallback chains) -> tenant default -> first enabled language -> en.
 * A tenant's enabled-language list constrains every step, so a French-only
 * club never shows a German UI by accident.
 */
export function resolveLocale(src: LocaleSources): Locale {
  const allowed = allowedLocales(src.tenantLanguages);
  const explicit = [src.userPreference, src.cookie];
  for (const c of explicit) {
    const hit = pickLocale(c, allowed);
    if (hit) return hit;
  }
  const browser = matchAcceptLanguage(src.acceptLanguage, allowed);
  if (browser) return browser;
  const tenant = pickLocale(src.tenantDefault, allowed);
  if (tenant) return tenant;
  // A tenant default outside its own enabled list still wins over an arbitrary pick.
  const tenantAny = matchLocale(src.tenantDefault);
  if (tenantAny) return tenantAny;
  return allowed?.[0] ?? DEFAULT_LOCALE;
}

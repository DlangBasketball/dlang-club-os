import { DEFAULT_LOCALE, LOCALES, normalizeLocale, type Locale } from "./config";

/**
 * Parse an Accept-Language header and return the best supported locale.
 *   "de-CH,de;q=0.9,en;q=0.8" -> "de"
 *   "pt-BR,pt;q=0.9"          -> null (nothing supported)
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const loc = normalizeLocale(tag);
    if (loc) return loc;
  }
  return null;
}

export type LocaleSources = {
  /** Explicit choice stored on the user's profile (profiles.locale with locale_set_at). */
  userPreference?: string | null;
  /** Explicit choice stored in the locale cookie (works signed-out too). */
  cookie?: string | null;
  /** Tenant default (app_settings.default_locale). */
  tenantDefault?: string | null;
  /** Tenant's enabled languages; when set, only these are allowed. */
  tenantLanguages?: readonly string[] | null;
  /** Raw Accept-Language header. */
  acceptLanguage?: string | null;
};

/**
 * Locale resolution order:
 *   user preference -> cookie -> tenant default -> Accept-Language -> "en"
 * A tenant's enabled-language list (if any) constrains every step except the
 * final fallback, so a French-only club never shows a German UI by accident.
 */
export function resolveLocale(src: LocaleSources): Locale {
  const allowed = new Set<Locale>(
    (src.tenantLanguages ?? [])
      .map((l) => normalizeLocale(l))
      .filter((l): l is Locale => l !== null),
  );
  const ok = (l: Locale | null): l is Locale => l !== null && (allowed.size === 0 || allowed.has(l));

  const candidates: (Locale | null)[] = [
    normalizeLocale(src.userPreference),
    normalizeLocale(src.cookie),
    normalizeLocale(src.tenantDefault),
    matchAcceptLanguage(src.acceptLanguage),
  ];
  for (const c of candidates) if (ok(c)) return c;
  // Nothing matched the tenant's list: use the tenant default, or the first enabled language.
  const tenant = normalizeLocale(src.tenantDefault);
  if (tenant) return tenant;
  const first = LOCALES.find((l) => allowed.has(l));
  return first ?? DEFAULT_LOCALE;
}

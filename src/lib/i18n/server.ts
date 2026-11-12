import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LOCALES,
  LOCALE_COOKIE,
  currencyForCountry,
  intlLocaleFor,
  normalizeLocale,
  timezoneForCountry,
  type Locale,
  type LocaleContext,
} from "./config";
import { resolveLocale } from "./negotiate";
import { CATALOGS, getMessages } from "./messages";
import { createTranslator, type Messages, type Translator } from "./translator";
import { createFormatter, type Formatter } from "@/lib/format";

export type { LocaleContext } from "./config";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

type TenantLocaleSettings = {
  orgId: string;
  country: string | null;
  currency: string | null;
  defaultLocale: string | null;
  timeZone: string | null;
  languages: Locale[] | null;
};

/** Org-level localisation settings (service role; never exposes other columns). */
async function loadTenantSettings(orgId: string): Promise<TenantLocaleSettings | null> {
  try {
    const admin = createAdminClient();
    // select("*") so this keeps working before/after the i18n migration adds columns.
    const [{ data: org }, { data: settings }] = await Promise.all([
      admin.from("organizations").select("*").eq("id", orgId).maybeSingle(),
      admin.from("app_settings").select("*").eq("org_id", orgId).maybeSingle(),
    ]);
    const o = (org ?? {}) as Row;
    const s = (settings ?? {}) as Row;
    const json = (s.settings && typeof s.settings === "object" ? s.settings : {}) as Row;
    const loc = (json.localization && typeof json.localization === "object" ? json.localization : {}) as Row;
    // settings.languages is what the admin "Languages & currency" form stores;
    // app_settings.enabled_locales is the typed column added by the i18n migration.
    const rawLangs = Array.isArray(json.languages)
      ? json.languages
      : Array.isArray(s.enabled_locales)
        ? s.enabled_locales
        : Array.isArray(loc.languages)
          ? loc.languages
          : null;
    const languages = rawLangs
      ? rawLangs.map((l) => normalizeLocale(String(l))).filter((l): l is Locale => l !== null)
      : null;
    return {
      orgId,
      country: str(o.country),
      currency: str(s.currency) ?? str(o.currency),
      defaultLocale: str(s.default_locale) ?? str(o.default_locale),
      timeZone: str(s.timezone) ?? str(o.timezone) ?? str(json.timezone) ?? str(loc.timezone),
      languages: languages && languages.length ? languages : null,
    };
  } catch {
    return null;
  }
}

type UserLocale = { orgId: string | null; preference: string | null };

async function loadUserLocale(): Promise<UserLocale | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    const p = (data ?? {}) as Row;
    // profiles.locale defaults to 'en' for everyone, so it only counts as a
    // preference once the user explicitly picked a language (locale_set_at).
    const explicit = Boolean(p.locale_set_at);
    return { orgId: str(p.org_id), preference: explicit ? str(p.locale) : null };
  } catch {
    return null;
  }
}

/**
 * Resolve the request's locale + tenant formatting context. Cached per
 * request. Pass `orgId` on public, tenant-specific pages (e.g. registration)
 * where no user is signed in.
 *
 * Order: user preference -> locale cookie -> tenant default -> Accept-Language -> en.
 */
export const getLocaleContext = cache(async (orgId?: string | null): Promise<LocaleContext> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value ?? null;
  const acceptLanguage = headerStore.get("accept-language");

  const user = await loadUserLocale();
  const tenantId = orgId ?? user?.orgId ?? null;
  const tenant = tenantId ? await loadTenantSettings(tenantId) : null;

  const locale = resolveLocale({
    userPreference: user?.preference,
    cookie: cookieLocale,
    tenantDefault: tenant?.defaultLocale,
    tenantLanguages: tenant?.languages,
    acceptLanguage,
  });
  const country = (tenant?.country ?? "CH").toUpperCase();
  return {
    locale,
    intlLocale: intlLocaleFor(locale, country),
    currency: (tenant?.currency ?? currencyForCountry(country)).toUpperCase(),
    timeZone: tenant?.timeZone ?? timezoneForCountry(country),
    country,
    languages: tenant?.languages ?? [...LOCALES],
    orgId: tenantId,
  };
});

/** Server-side translator for the current request: `const t = await getTranslations();` */
export async function getTranslations(orgId?: string | null): Promise<Translator> {
  const ctx = await getLocaleContext(orgId);
  return createTranslator(ctx.locale, getMessages(ctx.locale), CATALOGS.en, ctx.intlLocale);
}

/** Server-side formatter bound to the tenant's currency/time zone and the user's language. */
export async function getFormatter(orgId?: string | null): Promise<Formatter> {
  const ctx = await getLocaleContext(orgId);
  return createFormatter({ locale: ctx.intlLocale, currency: ctx.currency, timeZone: ctx.timeZone });
}

/** Convenience: everything at once. `const { t, f, ctx } = await getI18n();` */
export async function getI18n(orgId?: string | null): Promise<{ t: Translator; f: Formatter; ctx: LocaleContext; messages: Messages }> {
  const ctx = await getLocaleContext(orgId);
  const messages = getMessages(ctx.locale);
  return {
    ctx,
    messages,
    t: createTranslator(ctx.locale, messages, CATALOGS.en, ctx.intlLocale),
    f: createFormatter({ locale: ctx.intlLocale, currency: ctx.currency, timeZone: ctx.timeZone }),
  };
}

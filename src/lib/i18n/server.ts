import "server-only";
import { getTenant } from "@/lib/tenant/server";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BASE_LOCALES,
  LOCALE_COOKIE,
  currencyForCountry,
  localeTagsFor,
  regionFor,
  timezoneForCountry,
  type LocaleContext,
} from "./config";
import { resolveLocale } from "./negotiate";
import { SOURCE_MESSAGES, getMessages } from "./messages";
import { createTranslator, type Messages, type Translator } from "./translator";
import { tenantLocaleSettingsFromRows, type TenantLocaleSettings } from "./tenant-settings";
import { createFormatter, type Formatter } from "@/lib/format";

export type { LocaleContext } from "./config";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Org-level localisation settings (service role; never exposes other columns). */
async function loadTenantSettings(orgId: string): Promise<TenantLocaleSettings | null> {
  try {
    const admin = createAdminClient();
    // select("*") so this keeps working before/after the i18n migrations add columns.
    const [{ data: org }, { data: settings }] = await Promise.all([
      admin.from("organizations").select("*").eq("id", orgId).maybeSingle(),
      admin.from("app_settings").select("*").eq("org_id", orgId).maybeSingle(),
    ]);
    return tenantLocaleSettingsFromRows(orgId, (org ?? null) as Row | null, (settings ?? null) as Row | null);
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
 * Order: user preference -> locale cookie -> Accept-Language -> tenant default -> en,
 * constrained to the tenant's enabled languages (see ./negotiate.ts). The
 * tenant's region for that language then picks the regional catalog
 * (de + CH -> de-CH) and the Intl formats.
 */
export const getLocaleContext = cache(async (orgId?: string | null): Promise<LocaleContext> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value ?? null;
  const acceptLanguage = headerStore.get("accept-language");

  const user = await loadUserLocale();
  // Signed-out pages fall back to the tenant resolved from the request host.
  let tenantId = orgId ?? user?.orgId ?? null;
  if (!tenantId) {
    try {
      tenantId = (await getTenant()).id;
    } catch {
      tenantId = null;
    }
  }
  const tenant = tenantId ? await loadTenantSettings(tenantId) : null;

  const locale = resolveLocale({
    userPreference: user?.preference,
    cookie: cookieLocale,
    tenantDefault: tenant?.defaultLocale,
    tenantLanguages: tenant?.languages,
    acceptLanguage,
  });
  const country = (tenant?.country ?? "CH").toUpperCase();
  const tags = localeTagsFor(locale, regionFor(locale, tenant?.regions, country));
  return {
    locale,
    catalogLocale: tags.catalogLocale,
    dir: tags.dir,
    intlLocale: tags.intlLocale,
    currency: (tenant?.currency ?? currencyForCountry(country)).toUpperCase(),
    timeZone: tenant?.timeZone ?? timezoneForCountry(country),
    country,
    languages: tenant?.languages ?? [...BASE_LOCALES],
    orgId: tenantId,
  };
});

/** Server-side translator for the current request: `const t = await getTranslations();` */
export async function getTranslations(orgId?: string | null): Promise<Translator> {
  const ctx = await getLocaleContext(orgId);
  return createTranslator(ctx.catalogLocale, getMessages(ctx.catalogLocale), SOURCE_MESSAGES, ctx.intlLocale);
}

/** Server-side formatter bound to the tenant's currency/time zone and the user's language. */
export async function getFormatter(orgId?: string | null): Promise<Formatter> {
  const ctx = await getLocaleContext(orgId);
  return createFormatter({ locale: ctx.intlLocale, currency: ctx.currency, timeZone: ctx.timeZone });
}

/** Convenience: everything at once. `const { t, f, ctx } = await getI18n();` */
export async function getI18n(orgId?: string | null): Promise<{ t: Translator; f: Formatter; ctx: LocaleContext; messages: Messages }> {
  const ctx = await getLocaleContext(orgId);
  const messages = getMessages(ctx.catalogLocale);
  return {
    ctx,
    messages,
    t: createTranslator(ctx.catalogLocale, messages, SOURCE_MESSAGES, ctx.intlLocale),
    f: createFormatter({ locale: ctx.intlLocale, currency: ctx.currency, timeZone: ctx.timeZone }),
  };
}

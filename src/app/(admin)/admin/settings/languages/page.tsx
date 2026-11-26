import { ErrorState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getI18n, getTranslations } from "@/lib/i18n/server";
import { tenantLocaleSettingsFromRows } from "@/lib/i18n/tenant-settings";
import {
  BASE_LOCALES,
  COUNTRY_TIMEZONE,
  LANGUAGES,
  baseLanguage,
  catalogLocaleFor,
  getLanguage,
  isLocale,
  languageNameIn,
  localeTagsFor,
  regionNameIn,
  type Locale,
} from "@/lib/i18n/config";
import { createFormatter } from "@/lib/format";
import { LanguageSettingsForm, type LanguageOption, type RegionPreview } from "@/components/i18n/language-settings-form";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("languageSettings.tab") };
}

const SAMPLE_DATE = "2026-03-21T15:30:00Z";

export default async function LanguageSettingsPage() {
  const { t, ctx } = await getI18n();
  const me = await getSessionUser();
  if (!me?.orgId) return <ErrorState message={t("languageSettings.errors.invalid")} />;

  // The caller's own org only (server-resolved), service-role read filtered by id.
  const admin = createAdminClient();
  const [{ data: org }, { data: settings }] = await Promise.all([
    admin.from("organizations").select("*").eq("id", me.orgId).maybeSingle(),
    admin.from("app_settings").select("*").eq("org_id", me.orgId).maybeSingle(),
  ]);
  if (!org) return <ErrorState message={t("languageSettings.errors.invalid")} />;
  const s = tenantLocaleSettingsFromRows(me.orgId, org as Record<string, unknown>, (settings ?? null) as Record<string, unknown> | null);
  const country = (s.country ?? "CH").toUpperCase();
  const currency = (s.currency ?? "CHF").toUpperCase();

  // The form offers base languages; a stored regional tag (fr-CH) shows as its
  // language with that region.
  const toBase = (tag: string): Locale => {
    const b = baseLanguage(tag);
    return isLocale(b) ? b : (tag as Locale);
  };
  const enabled = Array.from(new Set((s.languages ?? [ctx.locale]).map(toBase)));
  const regions: Record<string, string> = {};
  for (const tag of s.languages ?? []) {
    const r = tag.split("-")[1];
    if (r) regions[toBase(tag)] = r;
  }
  for (const [k, v] of Object.entries(s.regions)) regions[toBase(k)] = v;
  for (const l of BASE_LOCALES) regions[l] ??= country;
  const defaultLocale = toBase(s.defaultLocale ?? enabled[0] ?? "en");

  const option = (tag: string): LanguageOption => {
    const e = getLanguage(tag)!;
    return { tag, nativeName: e.nativeName, localName: languageNameIn(tag, ctx.catalogLocale), status: e.status, dir: e.dir };
  };
  const languages = BASE_LOCALES.map(option);
  const planned = LANGUAGES.filter((l) => l.status === "none" && !("overlay" in l)).map((l) => option(l.tag));

  const regionCodes = Array.from(new Set([country, ...Object.values(regions), ...Object.keys(COUNTRY_TIMEZONE)]));
  const previews: RegionPreview[] = regionCodes
    .map((region) => ({
      region,
      label: regionNameIn(region, ctx.catalogLocale),
      samples: Object.fromEntries(
        BASE_LOCALES.map((l) => {
          const { intlLocale } = localeTagsFor(l, region);
          const f = createFormatter({ locale: intlLocale, currency, timeZone: ctx.timeZone });
          return [
            l,
            {
              spelling: getLanguage(catalogLocaleFor(l, region))?.nativeName ?? l,
              money: f.money(1234.5),
              number: f.number(9876543.21),
              date: `${f.date(SAMPLE_DATE)} · ${f.time(SAMPLE_DATE)}`,
            },
          ];
        }),
      ),
    }))
    .sort((a, b) => (a.region === country ? -1 : b.region === country ? 1 : a.label.localeCompare(b.label, ctx.intlLocale)));

  return (
    <LanguageSettingsForm
      languages={languages}
      planned={planned}
      regions={previews}
      initial={{ enabled, defaultLocale, regions }}
      canEdit={me.roles.includes("admin")}
    />
  );
}

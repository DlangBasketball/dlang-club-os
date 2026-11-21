import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { listAdminPages, listPickerImages, loadAdminSite, requireAdminOrg } from "@/lib/site/admin-data";
import { siteContrastChecks } from "@/lib/site/theme";
import { getTenant } from "@/lib/tenant/server";
import { SOCIAL_KEYS } from "@/lib/website/settings-shape";
import { SiteTabs } from "@/components/site/admin/site-tabs";
import { SiteSettingsForm } from "@/components/site/admin/site-admin";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("site.settings.title") };
}

/** Site settings: switch on, template, languages, brand overrides, SEO, analytics, social. */
export default async function SiteSettingsPage() {
  const me = await requireAdminOrg();
  if (!me) redirect("/admin/dashboard");
  const { t, ctx } = await getI18n();
  const [site, tenant] = await Promise.all([loadAdminSite(me.orgId), getTenant()]);
  const [pages, images] = await Promise.all([listAdminPages(me.orgId, site.settings.defaultLanguage), listPickerImages(me.orgId)]);
  const s = site.settings;
  const contrast = siteContrastChecks({ template: s.template, branding: tenant.branding, palette: s.palette, fonts: s.fonts });
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("site.settings.title")} description={t("site.settings.description")} />
      <SiteTabs t={t} current="settings" />
      <SiteSettingsForm
        initial={{
          enabled: site.enabled,
          template: s.template,
          languages: s.languages.join(", "),
          defaultLanguage: s.defaultLanguage,
          contactEmail: s.contactEmail ?? "",
          logoPath: s.logoPath,
          faviconPath: s.faviconPath,
          palette: s.palette as Record<string, string>,
          fonts: s.fonts as Record<string, string>,
          social: s.social,
          titleSuffix: s.seo.titleSuffix ?? "",
          description: s.seo.description ?? {},
          ogImagePath: s.seo.ogImagePath ?? null,
          analyticsProvider: s.analytics.provider ?? "none",
          analyticsId: s.analytics.id ?? "",
          homePageId: s.homePageId,
        }}
        pages={pages.map((p) => ({ id: p.id, title: p.title, path: p.path }))}
        images={images}
        contrast={contrast.map((c) => ({ label: c.label, ratio: c.ratio, ok: c.ok, min: c.min }))}
        social={SOCIAL_KEYS}
        appLocale={ctx.locale}
      />
    </div>
  );
}

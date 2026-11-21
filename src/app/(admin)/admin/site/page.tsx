import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Globe } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, PageHeader, Badge } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { goLiveChecklist, listAdminPages, listAdminRedirects, loadAdminSite, requireAdminOrg } from "@/lib/site/admin-data";
import { SiteTabs } from "@/components/site/admin/site-tabs";
import { Checklist, NewPageForm, PageTree, StarterButton } from "@/components/site/admin/site-admin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("site.admin.title") };
}

/** Admin -> Site: page tree, go-live checklist, starter site. */
export default async function SiteAdminPage() {
  const me = await requireAdminOrg();
  if (!me) redirect("/admin/dashboard");
  const t = await getTranslations();
  const site = await loadAdminSite(me.orgId);
  const [pages, redirects] = await Promise.all([listAdminPages(me.orgId, site.settings.defaultLanguage), listAdminRedirects(me.orgId)]);
  const checklist = goLiveChecklist(site, pages, redirects.length);
  const host = site.customDomain ?? null;
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={t("site.admin.title")}
        description={t("site.admin.description")}
        actions={
          <Badge tone={site.enabled ? "success" : "neutral"} dot>
            {site.enabled ? t("site.admin.live") : t("site.admin.off")}
          </Badge>
        }
      />
      <SiteTabs t={t} current="pages" />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t("site.pages.heading")}</CardTitle></CardHeader>
            <CardBody className="space-y-5">
              <PageTree pages={pages} defaultLang={site.settings.defaultLanguage} />
              <NewPageForm pages={pages} />
            </CardBody>
          </Card>
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t("site.checklist.title")}</CardTitle></CardHeader>
            <CardBody className="space-y-4">
              <Checklist items={checklist} />
              <p className="flex items-start gap-2 text-sm text-text-secondary">
                <Globe className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{host ? t("site.checklist.domainSet", { host }) : t("site.checklist.domainHint", { slug: site.slug })}</span>
              </p>
              <a href="/admin/settings/branding" className="text-sm text-brand-primary underline">{t("site.checklist.domainLink")}</a>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("site.starter.title")}</CardTitle></CardHeader>
            <CardBody>
              <StarterButton hasPages={pages.length > 0} />
            </CardBody>
          </Card>
          {!site.coachesPublic && (
            <p className="rounded-lg border border-border bg-bg-secondary p-3 text-sm text-text-secondary">{t("site.admin.sectionsHint")} <a className="text-brand-primary underline" href="/admin/settings/website">{t("site.admin.sectionsLink")}</a></p>
          )}
        </aside>
      </div>
    </div>
  );
}

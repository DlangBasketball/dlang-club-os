import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { loadAdminSite, requireAdminOrg } from "@/lib/site/admin-data";
import { SiteTabs } from "@/components/site/admin/site-tabs";
import { ImportWizard } from "@/components/site/admin/site-admin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("site.import.title") };
}

/** "Import my current website": WordPress pages, posts and photos -> site. */
export default async function SiteImportPage() {
  const me = await requireAdminOrg();
  if (!me) redirect("/admin/dashboard");
  const t = await getTranslations();
  const site = await loadAdminSite(me.orgId);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("site.import.title")} description={t("site.import.description")} />
      <SiteTabs t={t} current="import" />
      <ImportWizard initialUrl={site.websiteUrl ?? ""} />
    </div>
  );
}

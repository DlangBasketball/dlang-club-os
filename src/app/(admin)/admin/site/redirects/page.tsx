import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { listAdminRedirects, requireAdminOrg } from "@/lib/site/admin-data";
import { SiteTabs } from "@/components/site/admin/site-tabs";
import { RedirectsManager } from "@/components/site/admin/site-admin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("site.redirects.title") };
}

/** Redirects: keep old website links (and their search ranking) working. */
export default async function SiteRedirectsPage() {
  const me = await requireAdminOrg();
  if (!me) redirect("/admin/dashboard");
  const t = await getTranslations();
  const rows = await listAdminRedirects(me.orgId);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("site.redirects.title")} description={t("site.redirects.description")} />
      <SiteTabs t={t} current="redirects" />
      <RedirectsManager rows={rows} />
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { listAdminSubmissions, requireAdminOrg } from "@/lib/site/admin-data";
import { SiteTabs } from "@/components/site/admin/site-tabs";
import { SubmissionsList } from "@/components/site/admin/site-admin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("site.forms.title") };
}

/** Website form submissions (contact and join also land in New contacts). */
export default async function SiteFormsPage() {
  const me = await requireAdminOrg();
  if (!me) redirect("/admin/dashboard");
  const t = await getTranslations();
  const rows = await listAdminSubmissions(me.orgId);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("site.forms.title")} description={t("site.forms.description")} />
      <SiteTabs t={t} current="forms" />
      <SubmissionsList rows={rows} />
    </div>
  );
}

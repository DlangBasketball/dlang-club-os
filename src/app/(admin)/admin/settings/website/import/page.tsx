import { ErrorState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { getWebsiteSettings } from "@/lib/website/server";
import { ImportPanel } from "@/components/website/admin/import-panel";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("website.admin.tabs.import") };
}

/** Settings -> Website -> Import from the club's existing WordPress website (preview, dry run, idempotent import). */
export default async function WebsiteImportPage() {
  const [t, me] = await Promise.all([getTranslations(), getSessionUser()]);
  if (!me?.orgId || !me.roles.includes("admin")) return <ErrorState message={t("website.errors.forbidden")} />;
  const settings = await getWebsiteSettings(me.orgId);
  return <ImportPanel websiteUrl={settings.websiteUrl} />;
}

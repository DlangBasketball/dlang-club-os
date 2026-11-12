import { ErrorState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAssistantState } from "@/lib/ai/settings";
import { getTranslations } from "@/lib/i18n/server";
import { appNameFromBranding } from "@/lib/tenant/app-name";
import { AppSettingsForm } from "@/components/admin/app-settings-form";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("appSettings.tab") };
}

export default async function AppSettingsPage() {
  const t = await getTranslations();
  const me = await getSessionUser();
  if (!me?.orgId) return <ErrorState message={t("appSettings.errors.generic")} />;

  // The caller's own org only (server-resolved), service-role read filtered by id.
  const admin = createAdminClient();
  const [{ data: org }, assistant] = await Promise.all([
    admin.from("organizations").select("name,branding").eq("id", me.orgId).maybeSingle(),
    getAssistantState(me.orgId),
  ]);
  if (!org) return <ErrorState message={t("appSettings.errors.generic")} />;

  return (
    <AppSettingsForm
      orgName={org.name}
      appName={appNameFromBranding(org.branding) ?? ""}
      assistant={assistant}
      canEdit={me.roles.includes("admin")}
    />
  );
}

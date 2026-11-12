import { PageHeader } from "@/components/ui";
import { AssistantChat } from "@/components/ai/assistant-chat";
import { AssistantUnavailable } from "@/components/ai/assistant-unavailable";
import { getClubContactEmail } from "@/lib/data/settings";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAssistantAccess } from "@/lib/ai/settings";
import { getTranslations } from "@/lib/i18n/server";

export default async function AdminAssistantPage() {
  const t = await getTranslations();
  const me = await getSessionUser();
  // Opt-in per club: platform configured + plan feature + admin switch + staff role.
  const access = await getAssistantAccess(me);
  const header = <PageHeader title={t("aiAssistant.pageTitle")} description={t("aiAssistant.pageDescription")} />;
  if (!access.allowed) {
    const canConfigure = Boolean(me?.roles.includes("admin")) && (access.reason === "disabled" || access.reason === "not_in_plan");
    return (
      <div className="animate-fade-up">
        {header}
        <AssistantUnavailable reason={access.reason} settingsHref={canConfigure ? "/admin/settings/app" : null} />
      </div>
    );
  }
  // Escalations go to the club office (Settings → Profile contact email).
  const email = await getClubContactEmail();
  return (
    <div className="animate-fade-up">
      {header}
      <AssistantChat scope="admin" supportHref={email ? `mailto:${email}` : "/admin/settings"} />
    </div>
  );
}

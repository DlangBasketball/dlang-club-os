import { PageHeader } from "@/components/ui";
import { AssistantUnavailable } from "@/components/ai/assistant-unavailable";
import { getTranslations } from "@/lib/i18n/server";

/** The assistant is a club-staff (admin/finance) feature; coaches are not offered it. */
export default async function CoachAssistantPage() {
  const t = await getTranslations();
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("aiAssistant.pageTitle")} />
      <AssistantUnavailable reason="role" />
    </div>
  );
}

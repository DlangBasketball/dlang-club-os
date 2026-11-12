import { PageHeader } from "@/components/ui";
import { AssistantChat } from "@/components/ai/assistant-chat";
import { getClubContactEmail } from "@/lib/data/settings";
export default async function CoachAssistantPage() {
  // Escalations go to the club office (Settings → Profile contact email).
  const email = await getClubContactEmail();
  return (<div className="animate-fade-up"><PageHeader title="Assistant" description="Summarize your assigned sessions." /><AssistantChat scope="coach" supportHref={email ? `mailto:${email}` : "/coach/schedule"} /></div>);
}

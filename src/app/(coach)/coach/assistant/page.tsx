import { PageHeader } from "@/components/ui";
import { AssistantChat } from "@/components/ai/assistant-chat";
export default function CoachAssistantPage() {
  return (<div className="animate-fade-up"><PageHeader title="Assistant" description="Summarize your assigned sessions." /><AssistantChat scope="coach" supportHref="mailto:info@dlangbasketball.ch" /></div>);
}

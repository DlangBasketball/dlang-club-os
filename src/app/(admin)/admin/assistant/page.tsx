import { PageHeader } from "@/components/ui";
import { AssistantChat } from "@/components/ai/assistant-chat";
export default function AdminAssistantPage() {
  return (<div className="animate-fade-up"><PageHeader title="Assistant" description="Summarize club operations, invoices, attendance and bookings." /><AssistantChat scope="admin" supportHref="mailto:info@dlangbasketball.ch" /></div>);
}

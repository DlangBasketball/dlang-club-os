import { PageHeader } from "@/components/ui";
import { AssistantChat } from "@/components/ai/assistant-chat";
export default function ParentAssistantPage() {
  return (<div className="animate-fade-up"><PageHeader title="Assistant" description="Ask about your family, invoices and bookings." /><AssistantChat scope="parent" supportHref="/parent/support" /></div>);
}

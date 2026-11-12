import { PageHeader } from "@/components/ui";
import { AssistantChat } from "@/components/ai/assistant-chat";
import { getClubContactEmail } from "@/lib/data/settings";
export default async function AdminAssistantPage() {
  // Escalations go to the club office (Settings → Profile contact email).
  const email = await getClubContactEmail();
  return (<div className="animate-fade-up"><PageHeader title="Assistant" description="Summarize club operations, invoices, attendance and bookings." /><AssistantChat scope="admin" supportHref={email ? `mailto:${email}` : "/admin/settings"} /></div>);
}

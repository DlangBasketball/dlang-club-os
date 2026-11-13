import { requireRole } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { ADMIN_ONLY_COMMS, ASSISTANT_HREF } from "@/components/layout/nav-config";
import { getNavNotifications } from "@/lib/data/notifications";
import { getAssistantAccess } from "@/lib/ai/settings";
import { AlertBanner } from "@/components/messaging/alerts";
import { getBannerAlerts } from "@/lib/messaging/data";

export default async function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(["admin", "finance"]);
  const [notifs, assistant, alerts] = await Promise.all([getNavNotifications(), getAssistantAccess(user), getBannerAlerts(user)]);
  // The assistant entry shows for admins even without the paid add-on (so
  // they can discover it and find the switch), and for everyone once it is on.
  const showAssistant =
    assistant.allowed ||
    (user.roles.includes("admin") && (assistant.reason === "disabled" || assistant.reason === "not_entitled"));
  return (
    <AppShell
      navKey="admin"
      user={user}
      notifications={{ data: notifs, viewAllHref: "/admin/notifications" }}
      hiddenHrefs={[...(showAssistant ? [] : [ASSISTANT_HREF]), ...(user.roles.includes("admin") ? [] : ADMIN_ONLY_COMMS)]}
    >
      <AlertBanner alerts={alerts} />
      {children}
    </AppShell>
  );
}

import { requireRole } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { ASSISTANT_HREF } from "@/components/layout/nav-config";
import { getNavNotifications } from "@/lib/data/notifications";
import { getAssistantAccess } from "@/lib/ai/settings";

export default async function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(["admin", "finance"]);
  const [notifs, assistant] = await Promise.all([getNavNotifications(), getAssistantAccess(user)]);
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
      hiddenHrefs={showAssistant ? undefined : [ASSISTANT_HREF]}
    >
      {children}
    </AppShell>
  );
}

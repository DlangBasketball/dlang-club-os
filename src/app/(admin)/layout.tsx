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
  // The assistant entry shows for admins whenever the club could use it (so
  // they can find the switch), and for everyone once it is actually on.
  const showAssistant =
    assistant.allowed ||
    (user.roles.includes("admin") && (assistant.reason === "disabled" || assistant.reason === "not_in_plan"));
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

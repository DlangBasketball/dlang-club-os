import { requireRole } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getNavNotifications } from "@/lib/data/notifications";

export default async function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(["admin", "finance"]);
  const notifs = await getNavNotifications();
  return (
    <AppShell navKey="admin" user={user} notifications={{ data: notifs, viewAllHref: "/admin/notifications" }}>
      {children}
    </AppShell>
  );
}

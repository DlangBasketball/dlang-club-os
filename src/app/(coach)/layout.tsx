import { requireRole } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getNavNotifications } from "@/lib/data/notifications";

export default async function CoachGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(["coach", "admin"]);
  const notifs = await getNavNotifications();
  return (
    <AppShell navKey="coach" user={user} notifications={{ data: notifs }}>
      {children}
    </AppShell>
  );
}

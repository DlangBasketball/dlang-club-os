import { requireRole } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getNavNotifications } from "@/lib/data/notifications";
import { getMyCoachPhoto } from "@/lib/data/coaches";

export default async function CoachGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(["coach", "admin"]);
  const [notifs, me] = await Promise.all([getNavNotifications(), getMyCoachPhoto(user.id).catch(() => null)]);
  return (
    <AppShell navKey="coach" user={user} notifications={{ data: notifs }} profilePhotoUrl={me ? me.photoUrl : undefined}>
      {children}
    </AppShell>
  );
}

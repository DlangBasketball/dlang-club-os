import { requireRole } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getMyOrgs } from "@/lib/family/orgs";
import { getNavNotifications } from "@/lib/data/notifications";
import { getMyCoachPhoto } from "@/lib/data/coaches";
import { AlertBanner } from "@/components/messaging/alerts";
import { getBannerAlerts } from "@/lib/messaging/data";

export default async function CoachGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(["coach", "admin"]);
  const [notifs, me, alerts, orgs] = await Promise.all([getNavNotifications(), getMyCoachPhoto(user.id).catch(() => null), getBannerAlerts(user), getMyOrgs()]);
  return (
    <AppShell navKey="coach" user={user} orgs={orgs} notifications={{ data: notifs }} profilePhotoUrl={me ? me.photoUrl : undefined}>
      <AlertBanner alerts={alerts} />
      {children}
    </AppShell>
  );
}

import { requireArea } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getMyOrgs } from "@/lib/family/orgs";
import { getNavNotifications } from "@/lib/data/notifications";
import { getMyCoachPhoto } from "@/lib/data/coaches";
import { AlertBanner } from "@/components/messaging/alerts";
import { getBannerAlerts } from "@/lib/messaging/data";
import { operationsHiddenHrefs } from "@/lib/operations/nav";
import { upgradeNav } from "@/lib/upgrades/nav";
import { FeatureGate } from "@/components/upgrades/feature-gate";
import { alumniHiddenHrefs } from "@/lib/alumni/data";

export default async function CoachGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireArea("coach", ["coach", "admin"]);
  const [notifs, me, alerts, opsHidden, orgs, upg, alumniHidden] = await Promise.all([getNavNotifications(), getMyCoachPhoto(user.id).catch(() => null), getBannerAlerts(user), operationsHiddenHrefs(user), getMyOrgs(), upgradeNav(user, "coach"), alumniHiddenHrefs(user)]);
  return (
    <AppShell navKey="coach" user={user} orgs={orgs} notifications={{ data: notifs }} profilePhotoUrl={me ? me.photoUrl : undefined} hiddenHrefs={[...opsHidden, ...upg.hidden, ...alumniHidden]}>
      <AlertBanner alerts={alerts} />
      <FeatureGate feature="coach_app" area="coach">{children}</FeatureGate>
    </AppShell>
  );
}

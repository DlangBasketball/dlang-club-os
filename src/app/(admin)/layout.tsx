import { requireArea } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getMyOrgs } from "@/lib/family/orgs";
import { buildAdminNav } from "@/components/layout/admin-nav";
import { getNavNotifications } from "@/lib/data/notifications";
import { getAdminNavContext } from "@/lib/data/admin-nav";
import { AlertBanner } from "@/components/messaging/alerts";
import { getBannerAlerts } from "@/lib/messaging/data";

export default async function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireArea("admin", ["admin", "finance"]);
  const [notifs, alerts, orgs, nav] = await Promise.all([getNavNotifications(), getBannerAlerts(user), getMyOrgs(), getAdminNavContext(user)]);
  // Built on the server: role filtering, plan gating and the club's selection
  // programmes are settled before the menu renders (no flash of hidden entries).
  const adminNav = buildAdminNav(nav);
  return (
    <AppShell
      navKey="admin"
      user={user}
      orgs={orgs}
      notifications={{ data: notifs, viewAllHref: "/admin/notifications" }}
      hiddenHrefs={[...(nav.hidden ?? [])]}
      lockedHrefs={[...(nav.locked ?? [])]}
      adminNav={adminNav}
    >
      <AlertBanner alerts={alerts} />
      {children}
    </AppShell>
  );
}

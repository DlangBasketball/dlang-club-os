import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getMyOrgs } from "@/lib/family/orgs";
import { getNavNotifications } from "@/lib/data/notifications";
import { AlertBanner } from "@/components/messaging/alerts";
import { getBannerAlerts } from "@/lib/messaging/data";
import { operationsHiddenHrefs } from "@/lib/operations/nav";
import { upgradeNav } from "@/lib/upgrades/nav";
import { programOnlyHiddenHrefs } from "@/lib/selection/visibility";
import { getActiveAthleteState } from "@/lib/participants/my-athletes";
import { ALL_ATHLETES } from "@/lib/participants/active-athlete";
import { ActiveAthleteSwitcher } from "@/components/participants/active-athlete-switcher";

export default async function ParentGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(["parent", "admin"]);
  // Invited parents must finish onboarding before entering the portal.
  if (
    user.roles.includes("parent") &&
    !user.roles.includes("admin") &&
    !user.onboardingCompleted
  ) {
    redirect("/onboarding");
  }
  const [notifs, alerts, opsHidden, orgs, upg, guestHidden, athleteState] = await Promise.all([getNavNotifications(), getBannerAlerts(user), operationsHiddenHrefs(user), getMyOrgs(), upgradeNav(user, "parent"), programOnlyHiddenHrefs(user), getActiveAthleteState()]);
  // Active-athlete switcher (2+ athletes): the cookie is re-validated against my_athletes() on every read.
  const switchable = athleteState.athletes.filter((a) => a.status !== "inactive");
  const switcher = switchable.length > 1 ? (
    <ActiveAthleteSwitcher athletes={switchable.map((a) => ({ id: a.id, firstName: a.firstName, kind: a.kind }))}
      active={athleteState.active === ALL_ATHLETES ? null : athleteState.active} />
  ) : null;
  return (
    <AppShell navKey="parent" user={user} orgs={orgs} notifications={{ data: notifs, viewAllHref: "/parent/notifications" }} hiddenHrefs={[...opsHidden, ...upg.hidden, ...guestHidden]} subHeader={switcher}>
      <AlertBanner alerts={alerts} />
      {children}
    </AppShell>
  );
}

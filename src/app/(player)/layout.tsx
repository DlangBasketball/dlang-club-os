import { requireRole } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getMyOrgs } from "@/lib/family/orgs";
import { getNavNotifications } from "@/lib/data/notifications";

/**
 * Player portal (/player): an athlete's own login. Same mobile shell as the
 * parent and coach apps. Only the `player` role enters (derived from
 * athletes.player_profile_id, never a staff role); other roles are sent to
 * their own home. The player RPCs re-check on the server, and the portal
 * never shows guardian contacts, medical data, staff notes or money.
 */
export default async function PlayerGroupLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["player"]);
  const [notifs, orgs] = await Promise.all([getNavNotifications(), getMyOrgs()]);
  return (
    <AppShell navKey="player" user={user} orgs={orgs} notifications={{ data: notifs }}>
      {children}
    </AppShell>
  );
}

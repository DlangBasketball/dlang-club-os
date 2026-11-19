import { requireAuth } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getNavNotifications } from "@/lib/data/notifications";

/**
 * Board & committees area. Open to admins and to current committee members
 * of any role (a parent can sit on the board); what each person sees is
 * decided by RLS (public.can_access_committee). The shell follows the
 * person's own app so the board feels part of it.
 */
export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const navKey = user.roles.includes("admin") || user.roles.includes("finance") ? "admin" : user.roles.includes("coach") ? "coach" : "parent";
  const notifs = await getNavNotifications();
  return (
    <AppShell navKey={navKey} user={user} notifications={{ data: notifs }}>
      {children}
    </AppShell>
  );
}

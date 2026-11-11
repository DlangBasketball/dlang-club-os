import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/get-user";
import { AppShell } from "@/components/layout/app-shell";
import { getNavNotifications } from "@/lib/data/notifications";

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
  const notifs = await getNavNotifications();
  return (
    <AppShell navKey="parent" user={user} notifications={{ data: notifs, viewAllHref: "/parent/notifications" }}>
      {children}
    </AppShell>
  );
}

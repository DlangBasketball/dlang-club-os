import { requireRole } from "@/lib/auth/get-user";
import { PlansPage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function PlansRoute() {
  const me = await requireRole(["coach", "admin"]);
  return <PlansPage base="/coach/development" isAdmin={me.roles.includes("admin")} />;
}

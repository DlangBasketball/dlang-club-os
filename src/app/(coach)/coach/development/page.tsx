import { requireRole } from "@/lib/auth/get-user";
import { DevHubPage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function DevelopmentHubRoute() {
  const me = await requireRole(["coach", "admin"]);
  return <DevHubPage base="/coach/development" isAdmin={me.roles.includes("admin")} />;
}

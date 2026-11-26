import { requireRole } from "@/lib/auth/get-user";
import { WellnessPage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function WellnessRoute() {
  const me = await requireRole(["coach", "admin"]);
  return <WellnessPage base="/coach/development" isAdmin={me.roles.includes("admin")} />;
}

import { requireRole } from "@/lib/auth/get-user";
import { AssessmentsPage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function AssessmentsRoute() {
  const me = await requireRole(["coach", "admin"]);
  return <AssessmentsPage base="/coach/development" isAdmin={me.roles.includes("admin")} />;
}

import { requireRole } from "@/lib/auth/get-user";
import { PlanPage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function PlanRoute({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(["coach", "admin"]);
  const { id } = await params;
  return <PlanPage base="/coach/development" isAdmin={me.roles.includes("admin")} id={id} />;
}

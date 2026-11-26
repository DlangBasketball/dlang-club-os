import { requireRole } from "@/lib/auth/get-user";
import { NutritionEditPage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function NutritionEditRoute({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(["coach", "admin"]);
  const { id } = await params;
  return <NutritionEditPage base="/coach/development" isAdmin={me.roles.includes("admin")} id={id} />;
}

import { requireRole } from "@/lib/auth/get-user";
import { NutritionPage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function NutritionRoute() {
  const me = await requireRole(["coach", "admin"]);
  return <NutritionPage base="/coach/development" isAdmin={me.roles.includes("admin")} />;
}

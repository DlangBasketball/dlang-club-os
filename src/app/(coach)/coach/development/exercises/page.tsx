import { requireRole } from "@/lib/auth/get-user";
import { ExercisesPage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function ExercisesRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireRole(["coach", "admin"]);
  const sp = await searchParams;
  return <ExercisesPage base="/coach/development" isAdmin={me.roles.includes("admin")} edit={typeof sp.edit === "string" ? sp.edit : undefined} />;
}

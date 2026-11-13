import { requireRole } from "@/lib/auth/get-user";
import { EvaluatePage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function EvaluateRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireRole(["coach", "admin"]);
  const sp = await searchParams;
  return <EvaluatePage base="/coach/development" isAdmin={me.roles.includes("admin")} athleteId={typeof sp.athlete === "string" ? sp.athlete : undefined} teamId={typeof sp.team === "string" ? sp.team : undefined} />;
}

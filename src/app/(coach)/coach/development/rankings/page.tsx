import { requireRole } from "@/lib/auth/get-user";
import { RankingsPage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function RankingsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireRole(["coach", "admin"]);
  const sp = await searchParams;
  return <RankingsPage base="/coach/development" isAdmin={me.roles.includes("admin")} group={typeof sp.group === "string" ? sp.group : undefined} />;
}

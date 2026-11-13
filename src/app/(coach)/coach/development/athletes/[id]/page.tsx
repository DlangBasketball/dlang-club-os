import { requireRole } from "@/lib/auth/get-user";
import { AthletePage } from "@/components/development/pages";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function AthleteDevelopmentRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireRole(["coach", "admin"]);
  const { id } = await params;
  const sp = await searchParams;
  return <AthletePage base="/coach/development" isAdmin={me.roles.includes("admin")} id={id} view={typeof sp.view === "string" ? sp.view : undefined} />;
}

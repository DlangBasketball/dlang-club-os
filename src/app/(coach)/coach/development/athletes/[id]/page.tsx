import { requireRole } from "@/lib/auth/get-user";
import { AthletePage } from "@/components/development/pages";
import { SafetyInfoCard } from "@/components/forms/registration-panels";

/** Coaches see the athletes they coach (RLS: coach_can_access_athlete). */
export default async function AthleteDevelopmentRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireRole(["coach", "admin"]);
  const { id } = await params;
  const sp = await searchParams;
  return (
    <div className="space-y-5">
      <AthletePage base="/coach/development" isAdmin={me.roles.includes("admin")} id={id} view={typeof sp.view === "string" ? sp.view : undefined} />
      {/* Safety-flagged form answers (allergies, emergency contact ...) of an athlete this coach coaches. */}
      {/^[0-9a-f-]{36}$/i.test(id) && <div className="max-w-4xl"><SafetyInfoCard athleteId={id} /></div>}
    </div>
  );
}

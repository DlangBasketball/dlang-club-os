import { notFound } from "next/navigation";
import { PageHeader, Card, CardBody, ErrorState } from "@/components/ui";
import { TeamForm } from "@/components/teams/team-form";
import { getTeam, listCoachOptions, listProgramOptions, listSeasons } from "@/lib/sportsops/data";

export const metadata = { title: "Edit team" };

export default async function EditTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [team, seasons, programs, coaches] = await Promise.all([getTeam(id), listSeasons(), listProgramOptions(), listCoachOptions()]);
  const error = team.error ?? seasons.error ?? programs.error ?? coaches.error;
  if (error) return <div className="animate-fade-up"><PageHeader title="Edit team" /><ErrorState message={error} /></div>;
  const t = team.data;
  if (!t) notFound();
  // Keep coaches already on the team selectable even when deactivated, so saving never drops them.
  const coachOptions = [
    ...coaches.data!,
    ...t.coaches.filter((c) => !coaches.data!.some((o) => o.id === c.id)).map((c) => ({ id: c.id, name: c.name })),
  ];
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title={`Edit ${t.name}`} />
      <Card><CardBody>
        <TeamForm teamId={t.id}
          initial={{
            name: t.name, seasonId: t.seasonId ?? "", programId: t.programId ?? "", sport: t.sport ?? "", ageGroup: t.ageGroup ?? "",
            gender: t.gender ?? "", level: t.level ?? "", color: t.color ?? "", notes: t.notes ?? "", isActive: t.isActive,
            coaches: t.coaches.map((c) => ({ coachId: c.id, role: c.role as "head" | "assistant" | "manager" | "trainer" })),
          }}
          seasons={seasons.data!.map((s) => ({ id: s.id, name: s.name }))} programs={programs.data!} coaches={coachOptions} />
      </CardBody></Card>
    </div>
  );
}

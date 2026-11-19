import { PageHeader, Card, CardBody, ErrorState } from "@/components/ui";
import { TeamForm } from "@/components/teams/team-form";
import { listCoachOptions, listProgramOptions, listSeasons } from "@/lib/sportsops/data";

export const metadata = { title: "New team" };

export default async function NewTeamPage() {
  const [seasons, programs, coaches] = await Promise.all([listSeasons(), listProgramOptions(), listCoachOptions()]);
  const error = seasons.error ?? programs.error ?? coaches.error;
  if (error) return <div className="animate-fade-up"><PageHeader title="New team" /><ErrorState message={error} /></div>;
  const ordered = [...seasons.data!].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title="New team" description="Teams are sport-agnostic: name them the way your club does." />
      <Card><CardBody>
        <TeamForm seasons={ordered.map((s) => ({ id: s.id, name: s.name }))} programs={programs.data!} coaches={coaches.data!} />
      </CardBody></Card>
    </div>
  );
}

import { PageHeader, Card, CardBody, ErrorState } from "@/components/ui";
import { TeamForm } from "@/components/teams/team-form";
import { listCoachOptions, listProgramOptions, listSeasons } from "@/lib/sportsops/data";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("teamAdmin.form.newTitle") };
}

/** New team. `?program=<id>` preselects a programme (e.g. a selection programme's EYBL team). */
export default async function NewTeamPage({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const [t, sp, seasons, programs, coaches] = await Promise.all([getTranslations(), searchParams, listSeasons(), listProgramOptions(), listCoachOptions()]);
  const error = seasons.error ?? programs.error ?? coaches.error;
  if (error) return <div className="animate-fade-up"><PageHeader title={t("teamAdmin.form.newTitle")} /><ErrorState message={error} /></div>;
  const ordered = [...seasons.data!].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  const programId = sp.program && programs.data!.some((p) => p.id === sp.program) ? sp.program : "";
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title={t("teamAdmin.form.newTitle")} description={t("teamAdmin.form.newDescription")} />
      <Card><CardBody>
        <TeamForm seasons={ordered.map((s) => ({ id: s.id, name: s.name }))} programs={programs.data!} coaches={coaches.data!}
          initial={programId ? { programId } : undefined} />
      </CardBody></Card>
    </div>
  );
}

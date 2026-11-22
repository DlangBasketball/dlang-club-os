import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ErrorState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { todayIn } from "@/lib/payments/plans";
import { getSeasonPrograms, getTournaments, seasonsOf } from "@/lib/selection/roster";
import { EnrollmentForm } from "@/components/selection/roster/enrollment-form";
import { createClient } from "@/lib/supabase/server";
import { selectionDb } from "@/lib/selection/db";
import type { DirectoryAthlete } from "@/lib/actions/selection-roster";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("roster.add.title") };
}

/** Add a player to a selection programme (admin): the single enrolment form. */
export default async function AddRosterPlayerPage({ params, searchParams }: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { programId } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const athleteParam = /^[0-9a-f-]{36}$/i.test(one(sp.athlete)) ? one(sp.athlete) : null;
  const divisionParam = /^[0-9a-f-]{36}$/i.test(one(sp.division)) ? one(sp.division) : null;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(programId)) notFound();
  if (!me.roles.includes("admin")) redirect(`/admin/selection/${programId}?tab=players`);
  const all = await getSeasonPrograms(me.orgId);
  if (all.error) return <ErrorState title={t("roster.loadFailedTitle")} message={t("roster.seasonsFailed")} />;
  const seasons = seasonsOf(all.data, programId);
  const program = seasons.find((s) => s.id === programId);
  if (!program) notFound();
  const tournaments = await getTournaments(me.orgId, seasons.map((s) => s.id));
  // Pre-selected player (from the athlete profile or "Team member, no enrollment").
  let athlete: DirectoryAthlete | null = null;
  if (athleteParam) {
    const db = await createClient();
    const { data: a } = await db.from("athletes").select("id,first_name,last_name,dob,status,licence_category")
      .eq("id", athleteParam).eq("org_id", me.orgId).neq("status", "archived").maybeSingle();
    if (a) {
      const { data: apps } = await (await selectionDb()).from("program_applications").select("id,program_id,division_id,status")
        .eq("org_id", me.orgId).eq("athlete_id", a.id).in("program_id", seasons.map((s) => s.id)).not("status", "in", "(declined,withdrawn)");
      athlete = {
        id: a.id, name: `${a.first_name} ${a.last_name}`.trim(), dob: a.dob, status: a.status, familyName: null,
        licenceCategory: (a as { licence_category?: string | null }).licence_category ?? null,
        enrolled: (apps ?? []).map((x) => ({ applicationId: x.id, programId: x.program_id, divisionId: x.division_id, status: x.status })),
      };
    }
  }
  const division = divisionParam && program.divisions.some((d) => d.id === divisionParam) ? divisionParam : null;
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader eyebrow={<Link href={`/admin/selection/${programId}?tab=players`} className="hover:underline">{program.name}</Link>}
        title={t("roster.add.title")} description={t("roster.add.description")} />
      {tournaments.error && <ErrorState compact title={t("roster.loadFailedTitle")} message={t("roster.tournamentsFailed")} />}
      <EnrollmentForm mode={{ kind: "add", athlete, divisionId: division }} seasons={seasons} tournaments={tournaments.data} canEditDetails canEditFee
        today={todayIn(f.timeZone)} defaultProgramId={programId}
        manageTournamentsHref="/admin/selection/{id}?tab=setup#tournaments"
        recordHref="/admin/selection/{program}/players/{application}" />
    </div>
  );
}

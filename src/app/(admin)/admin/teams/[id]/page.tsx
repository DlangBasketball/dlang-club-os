import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Pencil } from "lucide-react";
import { PageHeader, Button, Card, CardHeader, CardTitle, CardBody, Badge, ErrorState, Avatar } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { RosterManager } from "@/components/teams/roster-manager";
import { EventList } from "@/components/schedule/event-views";
import { getTeam, listAthleteOptions, listUpcomingEvents, rsvpCounts } from "@/lib/sportsops/data";
import { labelsFor } from "@/lib/sportsops/labels";
import { getTenant } from "@/lib/tenant/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { SportTagPicker } from "@/components/sports/sports-manager";
import { currentSportId, sportOptions } from "@/lib/sports/data";

export const metadata = { title: "Team" };

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [tenant, tr] = await Promise.all([getTenant(), getTranslations()]);
  const LABELS = labelsFor(tenant.terminology);
  const { id } = await params;
  const [team, athletes, upcoming] = await Promise.all([getTeam(id), listAthleteOptions(), listUpcomingEvents({ teamIds: [id], limit: 8 })]);
  const error = team.error ?? athletes.error ?? upcoming.error;
  if (error) return <div className="animate-fade-up"><PageHeader title={LABELS.team} /><ErrorState message={error} /></div>;
  const t = team.data;
  if (!t) notFound();
  const counts = await rsvpCounts(upcoming.data!.map((e) => e.id));
  const me = await getSessionUser();
  const [sports, sportId] = me?.orgId && me.roles.includes("admin")
    ? await Promise.all([sportOptions(me.orgId), currentSportId("teams", t.id)])
    : [[], null];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t.name}
        description={[t.sport, t.ageGroup, t.gender, t.level, t.seasonName].filter(Boolean).join(" · ") || undefined}
        actions={<>
          <Link href={`/admin/schedule/new?team=${t.id}`}><Button size="sm" variant="secondary"><CalendarPlus className="h-4 w-4" /> Add event</Button></Link>
          <Link href={`/admin/teams/${t.id}/edit`}><Button size="sm" variant="secondary"><Pencil className="h-4 w-4" /> Edit</Button></Link>
        </>} />

      <SportTagPicker kind="team" recordId={t.id} value={sportId} sports={sports} />

      <div className="flex flex-wrap items-center gap-2">
        {t.coaches.length === 0 && <Badge tone="warning">No coach assigned</Badge>}
        {t.coaches.map((c) => (
          <Link key={c.id} href={`/admin/coaches/${c.id}`}
            className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated py-1 pl-1 pr-3 text-sm text-ink hover:border-border-strong">
            <Avatar name={c.name} src={c.photoUrl} size="md" />
            <span className="min-w-0">
              <span className="block font-medium leading-tight">{c.name}</span>
              <span className="block text-[11px] leading-tight text-ink-3">{tr.dynamic(`coaches.roles.${c.role}`, undefined, c.role)}</span>
            </span>
          </Link>
        ))}
        {!t.isActive && <Badge>inactive</Badge>}
        <Link href="/admin/coaches" className="text-xs text-ink-3 hover:text-ink">{tr("coaches.team.editCoaches")} →</Link>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{LABELS.roster} <span className="text-sm font-normal text-ink-3">({t.roster.filter((r) => r.status !== "inactive").length})</span></h2>
        <RosterManager teamId={t.id} roster={t.roster} athletes={athletes.data!} />
      </section>

      <Card>
        <CardHeader><CardTitle>Upcoming</CardTitle><Link href={`/admin/schedule?view=list&team=${t.id}`} className="text-xs text-ink-3 hover:text-ink">Full schedule →</Link></CardHeader>
        <CardBody>
          <EventList events={upcoming.data!} href={(eid) => `/admin/schedule/${eid}`} rsvp={counts}
            empty={<p className="text-sm text-ink-3">Nothing scheduled for this team yet.</p>} />
        </CardBody>
      </Card>
      {t.notes && <Card><CardBody><p className="whitespace-pre-wrap text-sm text-ink-2">{t.notes}</p></CardBody></Card>}
    </div>
  );
}

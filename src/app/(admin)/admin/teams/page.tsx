import Link from "next/link";
import { Pencil, Plus, Search, Shield } from "lucide-react";
import { PageHeader, Button, Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, ErrorState, Avatar, Input } from "@/components/ui";
import { SeasonForm } from "@/components/teams/season-form";
import { DeleteTeamButton, RestoreTeamButton } from "@/components/teams/delete-team";
import { listSeasons, listTeams, type TeamSummary } from "@/lib/sportsops/data";
import { labelsFor } from "@/lib/sportsops/labels";
import { getTenant } from "@/lib/tenant/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { selectClass } from "@/components/teams/fields";
import { getI18n, getTranslations } from "@/lib/i18n/server";
import { splitTeamsBySeason } from "@/lib/teams/programme-teams";
import { groupTeamsByCategory, type TeamGroup } from "@/lib/teams/categories";
import { searchPlayersWithTeams } from "@/lib/data/team-attendance-admin";
import { zonedDayKey } from "@/lib/staff/hours";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("teamAdmin.list.title") };
}

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ season?: string; all?: string; q?: string }> }) {
  const LABELS = labelsFor((await getTenant()).terminology);
  const [{ t: tr, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  const isAdmin = !!me?.roles.includes("admin");
  const sp = await searchParams;
  const seasons = await listSeasons();
  if (seasons.error !== null) return <div className="animate-fade-up"><PageHeader title={LABELS.teams} /><ErrorState message={seasons.error} /></div>;
  const current = seasons.data.find((s) => s.isCurrent);
  const seasonId = sp.season === "all" ? undefined : sp.season ?? current?.id;
  // A season filter also lists the teams without a season ("No season" group),
  // so programme teams created without one never silently disappear.
  const teams = await listTeams({ seasonId, includeInactive: sp.all === "1", includeNoSeason: true });
  if (teams.error !== null) return <div className="animate-fade-up"><PageHeader title={LABELS.teams} /><ErrorState message={teams.error} /></div>;
  const { inSeason, noSeason } = splitTeamsBySeason(teams.data, seasonId);
  // Club teams and selection teams in separate sections, grouped by category
  // derived from the team data (age group / name / level); empty teams stay listed.
  const sections = groupTeamsByCategory(inSeason);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const hits = q ? await searchPlayersWithTeams(q, zonedDayKey(new Date(), f.timeZone)) : null;
  const newTeam = <Link href="/admin/teams/new"><Button size="sm"><Plus className="h-4 w-4" /> {tr("teamAdmin.list.newTeam")}</Button></Link>;

  const card = (t: TeamSummary) => (
    <Card key={t.id} className="h-full transition-colors hover:border-maroon" style={t.color ? { borderTop: `3px solid ${t.color}` } : undefined}>
      <CardBody>
        <div className="flex items-start justify-between gap-2">
          <Link href={`/admin/teams/${t.id}`} className="text-base font-semibold text-ink hover:text-maroon">{t.name}</Link>
          <div className="flex shrink-0 items-center gap-1">
            {!t.isActive && <Badge>{tr("teamAdmin.list.archived")}</Badge>}
            <Link href={`/admin/teams/${t.id}/edit`} aria-label={tr("editOps.teams.editNamed", { name: t.name })}>
              <Button size="sm" variant="ghost"><Pencil className="h-3.5 w-3.5" /> {tr("common.edit")}</Button>
            </Link>
            {isAdmin && t.isActive && <DeleteTeamButton teamId={t.id} name={t.name} variant="icon" />}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-ink-3">
          {t.programName && <Badge tone={t.isSelectionProgram ? "accent" : "neutral"}>{t.programName}</Badge>}
          {[t.sport, t.ageGroup, t.gender, t.level].filter(Boolean).map((x) => <Badge key={x} tone="neutral">{x}</Badge>)}
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-ink-2">
          <span className="flex min-w-0 items-center gap-2">
            {t.coaches.length > 0 && (
              <span className="flex -space-x-2">
                {t.coaches.slice(0, 3).map((c) => <Avatar key={c.id} name={c.name} src={c.photoUrl} size="sm" className="ring-2 ring-[var(--surface)]" />)}
              </span>
            )}
            <span className="truncate">{t.coaches.length ? t.coaches.map((c) => c.name).join(", ") : tr("teamAdmin.list.noCoach")}</span>
          </span>
          <span className="tnum text-ink">{f.number(t.rosterCount)} {t.rosterCount === 1 ? LABELS.athlete.toLowerCase() : LABELS.athletes.toLowerCase()}</span>
        </div>
        {t.seasonName && <div className="mt-1 text-xs text-ink-3">{t.seasonName}</div>}
        {isAdmin && !t.isActive && <div className="mt-3"><RestoreTeamButton teamId={t.id} name={t.name} /></div>}
      </CardBody>
    </Card>
  );

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={LABELS.teams} description={tr("teamAdmin.list.description")} actions={newTeam} />

      <form className="flex flex-wrap items-center gap-2" method="get" role="search">
        <label className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input name="q" defaultValue={q} placeholder={tr("adminAttendance.teams.searchPlaceholder")} aria-label={tr("adminAttendance.teams.searchLabel")} className="pl-9" />
        </label>
        {sp.season && <input type="hidden" name="season" value={sp.season} />}
        <Button type="submit" size="sm" variant="secondary">{tr("adminAttendance.teams.search")}</Button>
        {q && <Link href="/admin/teams" className="text-xs text-maroon hover:underline">{tr("adminAttendance.teams.clearSearch")}</Link>}
      </form>

      {hits && (
        <Card>
          <CardHeader><CardTitle>{tr("adminAttendance.teams.results", { query: q })}</CardTitle></CardHeader>
          <CardBody className="p-0">
            {hits.error !== null ? <div className="p-5"><ErrorState message={tr("teamAttendance.errors.generic")} /></div>
              : hits.data.length === 0 ? <p className="px-5 py-5 text-sm text-ink-3">{tr("adminAttendance.teams.noResults")}</p> : (
                <ul>
                  {hits.data.map((h) => (
                    <li key={h.id} className="flex flex-col gap-1 border-b border-line-soft px-5 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                      <Link href={`/admin/athletes/${h.id}?tab=teams`} className="text-sm font-medium text-ink hover:text-maroon">{h.name}</Link>
                      <span className="flex flex-wrap gap-1.5">
                        {h.teams.length === 0 ? <span className="text-xs text-ink-3">{tr("adminAttendance.teams.noTeam")}</span> : h.teams.map((a) => (
                          <Link key={a.teamId} href={`/admin/teams/${a.teamId}`}>
                            <Badge tone={a.isCurrentSeason ? "maroon" : "neutral"}>{a.teamName}{a.jerseyNumber !== null ? ` · #${a.jerseyNumber}` : ""}{a.seasonName && !a.isCurrentSeason ? ` · ${a.seasonName}` : ""}</Badge>
                          </Link>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </CardBody>
        </Card>
      )}

      <form className="flex flex-wrap items-center gap-3" method="get">
        <select name="season" defaultValue={sp.season ?? current?.id ?? "all"} className={`${selectClass} w-56`} aria-label={tr("teamAdmin.list.season")}>
          <option value="all">{tr("teamAdmin.list.allSeasons")}</option>
          {seasons.data.map((s) => <option key={s.id} value={s.id}>{s.isCurrent ? tr("teamAdmin.list.currentSeasonOption", { name: s.name }) : s.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="h-4 w-4 accent-[var(--red-primary)]" /> {tr("teamAdmin.list.includeInactive")}</label>
        <Button type="submit" size="sm" variant="secondary">{tr("teamAdmin.list.filter")}</Button>
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {teams.data.length === 0 ? (
            <EmptyState icon={<Shield className="h-5 w-5" />} title={tr("teamAdmin.list.emptyTitle")}
              description={seasons.data.length ? tr("teamAdmin.list.emptyHint") : tr("teamAdmin.list.emptyNoSeason")}
              action={newTeam} />
          ) : (
            <>
              {([["club", sections.club], ["selection", sections.selection]] as const).map(([kind, groups]) => groups.length > 0 && (
                <section key={kind} className="space-y-4" aria-labelledby={`teams-${kind}`}>
                  <h2 id={`teams-${kind}`} className="text-lg font-semibold text-ink">
                    {kind === "club" ? tr("adminAttendance.teams.clubTeams") : tr("adminAttendance.teams.selectionTeams")}
                  </h2>
                  {groups.map((g: TeamGroup<TeamSummary>) => (
                    <div key={g.key} className="space-y-2">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-3">
                        {g.label ?? tr("adminAttendance.teams.otherGroup")} <span className="font-normal normal-case tracking-normal">· {tr("adminAttendance.teams.teamCount", { count: g.teams.length })}</span>
                      </h3>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{g.teams.map(card)}</div>
                    </div>
                  ))}
                </section>
              ))}
              {noSeason.length > 0 && (
                <section className="space-y-3" aria-labelledby="teams-no-season">
                  <div>
                    <h2 id="teams-no-season" className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-3">{tr("teamAdmin.list.noSeasonGroup")}</h2>
                    <p className="text-xs text-ink-3">{tr("teamAdmin.list.noSeasonHint")}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{noSeason.map(card)}</div>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader><CardTitle>{tr("teamAdmin.list.seasons")}</CardTitle></CardHeader>
            <CardBody className="space-y-4">
              {seasons.data.length === 0 && <p className="text-sm text-ink-3">{tr("teamAdmin.list.noSeasons")}</p>}
              <ul className="space-y-2 text-sm">
                {seasons.data.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="text-xs text-ink-3">{f.date(s.startsOn)} – {f.date(s.endsOn)}{s.isCurrent && <Badge tone="maroon" className="ml-2">{tr("teamAdmin.list.current")}</Badge>}</span>
                  </li>
                ))}
              </ul>
              <div className="border-t border-line-soft pt-4"><SeasonForm /></div>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

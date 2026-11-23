import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Pencil } from "lucide-react";
import { PageHeader, Button, Card, CardHeader, CardTitle, CardBody, Badge, ErrorState, Avatar, Input, EmptyState } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { RosterManager } from "@/components/teams/roster-manager";
import { getTeam, listAthleteOptions, listSeasons, listTeams } from "@/lib/sportsops/data";
import { labelsFor } from "@/lib/sportsops/labels";
import { getTenant } from "@/lib/tenant/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { SportTagPicker } from "@/components/sports/sports-manager";
import { currentSportId, sportOptions } from "@/lib/sports/data";
import { CoverImage } from "@/components/media/cover-image";
import { getTeamCover } from "@/lib/media/server";
import { DeleteTeamButton, RestoreTeamButton } from "@/components/teams/delete-team";
import { ProfileTabs, type ProfileTab } from "@/components/athlete/profile-tabs";
import { selectClass } from "@/components/teams/fields";
import { zonedDayKey } from "@/lib/staff/hours";
import { dateParam, sheetState, teamTotals } from "@/lib/attendance/admin-stats";
import { getAttendanceStats } from "@/lib/attendance/data";
import { getSessionAttendance, getTeamRosterView, getTeamSchedule } from "@/lib/data/team-attendance-admin";
import { AddPlayerForm, RosterRowActions } from "@/components/attendance/admin/roster-actions";
import { SessionHistoryList, SheetStateBadge, TotalsSummary } from "@/components/attendance/admin/views";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminAttendance.team.metaTitle") };
}

const TABS = ["roster", "coaches", "schedule", "attendance"] as const;
type Tab = (typeof TABS)[number];

type SP = { tab?: string; on?: string; from?: string; to?: string; season?: string };

/**
 * Team page (admin + finance read). Tabs: effective-dated roster (current,
 * "as of" a date, past members), coaches, upcoming training schedule
 * (cancelled sessions with their reason) and attendance history with totals
 * (admin only). Roster changes take an effective date (team_member_* RPCs).
 */
export default async function TeamDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const [tenant, { t: tr, f }] = await Promise.all([getTenant(), getI18n()]);
  const LABELS = labelsFor(tenant.terminology);
  const { id } = await params;
  const sp = await searchParams;
  const initialTab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "roster";
  const today = zonedDayKey(new Date(), f.timeZone);
  const on = dateParam(sp.on) ?? today;
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);

  const [team, me] = await Promise.all([getTeam(id), getSessionUser()]);
  if (team.error !== null) return <div className="animate-fade-up"><PageHeader title={LABELS.team} /><ErrorState message={team.error} /></div>;
  const t = team.data;
  if (!t) notFound();
  const isAdmin = !!me?.roles.includes("admin");
  const seasonId = sp.season === "all" ? null : sp.season ?? t.seasonId ?? null;

  const [athletes, cover, rosterView, schedule, seasons, allTeams, history, playerStats] = await Promise.all([
    isAdmin ? listAthleteOptions() : Promise.resolve({ data: [], error: null }),
    getTeamCover(t.id),
    getTeamRosterView(t.id, on),
    getTeamSchedule(t.id, { fromISO: new Date(Date.now() - 6 * 3600e3).toISOString(), limit: 40 }),
    listSeasons(),
    isAdmin ? listTeams({ includeNoSeason: true }) : Promise.resolve({ data: [], error: null }),
    isAdmin ? getSessionAttendance({ teamId: t.id, from, to, seasonId }) : Promise.resolve({ data: [], error: null }),
    isAdmin ? getAttendanceStats({ teamId: t.id, from, to, seasonId, group: "player" }) : Promise.resolve({ data: [], error: null }),
  ]);
  const [sports, sportId] = me?.orgId && isAdmin ? await Promise.all([sportOptions(me.orgId), currentSportId("teams", t.id)]) : [[], null];

  const managedBySelection = t.isSelectionProgram;
  const otherTeams = (allTeams.data ?? []).filter((x) => x.id !== t.id && x.isActive && !x.isSelectionProgram).map((x) => ({ id: x.id, name: x.name }));
  const rv = rosterView.data;
  const rosterIds = rv?.roster.map((r) => r.athleteId) ?? [];

  // ---- Roster tab -----------------------------------------------------------
  const rosterTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {on === today ? tr("adminAttendance.roster.current") : tr("adminAttendance.roster.asOf", { date: f.date(on) })}
            <span className="ml-2 text-sm font-normal text-text-muted">({f.number(rv?.roster.length ?? 0)})</span>
          </CardTitle>
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="tab" value="roster" />
            <Input type="date" name="on" defaultValue={on} className="h-9 w-40" aria-label={tr("adminAttendance.roster.asOfLabel")} />
            <Button type="submit" size="sm" variant="secondary">{tr("adminAttendance.roster.show")}</Button>
            {on !== today && <Link href={`/admin/teams/${t.id}?tab=roster`} className="text-xs text-brand-primary hover:underline">{tr("adminAttendance.roster.today")}</Link>}
          </form>
        </CardHeader>
        <CardBody className="space-y-4">
          {rosterView.error !== null ? <ErrorState message={tr.dynamic(`teamAttendance.errors.${rosterView.error}`, undefined, tr("teamAttendance.errors.generic"))} /> : (
            rv!.roster.length === 0 ? (
              <p className="text-sm text-text-muted">{tr("adminAttendance.roster.empty")}</p>
            ) : (
              <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
                {rv!.roster.map((r) => (
                  <li key={r.athleteId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/admin/athletes/${r.athleteId}?tab=teams`} className="text-sm font-medium text-text hover:text-brand-primary">
                        <span className="mr-2 font-mono text-xs text-text-muted">{r.jerseyNumber ?? "—"}</span>{r.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                        {r.position && <span>{r.position} ·</span>}
                        <span>{tr("adminAttendance.roster.since", { date: f.date(r.joinedOn) })}</span>
                        {r.leftOn && <span>· {tr("adminAttendance.roster.until", { date: f.date(r.leftOn) })}</span>}
                        {r.status !== "active" && <Badge>{tr.dynamic(`media.roster.status.${r.status}`, undefined, r.status)}</Badge>}
                        {r.otherTeams.map((o) => (
                          <Link key={o.teamId} href={`/admin/teams/${o.teamId}`}><Badge tone="accent">{tr("adminAttendance.roster.alsoOn", { team: o.teamName })}</Badge></Link>
                        ))}
                      </div>
                    </div>
                    {isAdmin && !managedBySelection && on === today && (
                      <RosterRowActions teamId={t.id} athleteId={r.athleteId} name={r.name} teams={otherTeams} today={today} />
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
          {isAdmin && !managedBySelection && (
            <div className="border-t border-border-soft pt-4">
              <AddPlayerForm teamId={t.id} players={athletes.data ?? []} excludeIds={on === today ? rosterIds : []} today={today} />
            </div>
          )}
          {managedBySelection && (
            <p className="text-xs text-text-muted">
              {tr("adminAttendance.roster.selectionManaged")}{" "}
              {t.programId && <Link href={`/admin/selection/${t.programId}`} className="text-brand-primary hover:underline">{tr("adminAttendance.roster.openProgramme")}</Link>}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{tr("adminAttendance.roster.past")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {!rv || rv.past.length === 0 ? (
            <p className="px-5 py-5 text-sm text-text-muted">{tr("adminAttendance.roster.noPast")}</p>
          ) : (
            <ul>
              {rv.past.map((p, i) => (
                <li key={`${p.athleteId}-${i}`} className="flex flex-col gap-1 border-b border-border-soft px-5 py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <Link href={`/admin/athletes/${p.athleteId}?tab=teams`} className="text-sm text-text hover:text-brand-primary">{p.name}</Link>
                  <span className="text-xs text-text-muted">
                    {f.date(p.joinedOn)} – {f.date(p.leftOn)}{p.reason ? ` · ${p.reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {isAdmin && (
        <details className="rounded-md border border-border-soft bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-text">{tr("adminAttendance.roster.editDetails")}</summary>
          <div className="mt-3">
            <RosterManager teamId={t.id} roster={t.roster} athletes={athletes.data ?? []} linkPlayers canAdd={false} canDeletePeople={false} />
          </div>
        </details>
      )}
    </div>
  );

  // ---- Coaches tab ----------------------------------------------------------
  const coachesTab = (
    <Card>
      <CardHeader>
        <CardTitle>{tr("adminAttendance.team.coaches")}</CardTitle>
        <Link href="/admin/coaches" className="text-xs text-brand-primary hover:underline">{tr("coaches.team.editCoaches")}</Link>
      </CardHeader>
      <CardBody>
        {t.coaches.length === 0 ? (
          <p className="text-sm text-warning">{tr("adminAttendance.team.noCoach")}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {t.coaches.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/coaches/${c.id}`} className="flex items-center gap-3 rounded-md border border-border-soft px-3 py-2 hover:border-border-strong">
                  <Avatar name={c.name} src={c.photoUrl} size="md" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text">{c.name}</span>
                    <span className="block text-xs text-text-muted">{tr.dynamic(`coaches.roles.${c.role}`, undefined, c.role)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-text-muted">{tr("adminAttendance.team.substituteHint")}</p>
      </CardBody>
    </Card>
  );

  // ---- Schedule tab -------------------------------------------------------------
  const scheduleTab = (
    <Card>
      <CardHeader>
        <CardTitle>{tr("adminAttendance.team.schedule")}</CardTitle>
        <Link href={`/admin/schedule?view=list&team=${t.id}`} className="text-xs text-brand-primary hover:underline">{tr("adminAttendance.team.fullSchedule")}</Link>
      </CardHeader>
      <CardBody className="p-0">
        {schedule.error !== null ? <div className="p-5"><ErrorState message={tr("teamAttendance.errors.generic")} /></div>
          : schedule.data.length === 0 ? <p className="px-5 py-5 text-sm text-text-muted">{tr("adminAttendance.team.noUpcoming")}</p> : (
            <ul>
              {schedule.data.map((e) => (
                <li key={e.eventId} className="flex flex-col gap-2 border-b border-border-soft px-5 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/admin/schedule/${e.eventId}/attendance`} className={`text-sm font-medium hover:text-brand-primary ${e.status === "cancelled" ? "text-text-muted line-through" : "text-text"}`}>
                      {f.date(e.startsAt, { weekday: true })} · {f.time(e.startsAt)}–{f.time(e.endsAt)}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-text-muted">
                      <span>{tr.dynamic(`adminAttendance.eventType.${e.type}`, undefined, e.type)}</span>
                      {e.title && <span>· {e.title}</span>}
                      {e.status === "cancelled" && <span>· {e.cancelReason ? tr("adminAttendance.history.cancelReason", { reason: e.cancelReason }) : tr("adminAttendance.sheetState.cancelled")}</span>}
                      {e.substitutes > 0 && <span>· {tr("adminAttendance.team.substitutes", { count: e.substitutes })}</span>}
                    </div>
                  </div>
                  <SheetStateBadge state={sheetState({ event_status: e.status, sheet_status: e.sheetStatus, ends_at: e.endsAt })} />
                </li>
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );

  // ---- Attendance tab (admin) ---------------------------------------------------------
  const pastRows = (history.data ?? []).filter((r) => Date.parse(r.starts_at) <= Date.now());
  const attendanceTab = isAdmin ? (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="attendance" />
        <label className="text-xs text-text-muted">{tr("adminAttendance.filters.from")}
          <Input type="date" name="from" defaultValue={from ?? ""} className="mt-1 h-9 w-40" />
        </label>
        <label className="text-xs text-text-muted">{tr("adminAttendance.filters.to")}
          <Input type="date" name="to" defaultValue={to ?? ""} className="mt-1 h-9 w-40" />
        </label>
        <label className="text-xs text-text-muted">{tr("adminAttendance.filters.season")}
          <select name="season" defaultValue={seasonId ?? "all"} className={`${selectClass} mt-1 h-9 w-48`}>
            <option value="all">{tr("adminAttendance.filters.allSeasons")}</option>
            {(seasons.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <Button type="submit" size="sm" variant="secondary">{tr("adminAttendance.filters.apply")}</Button>
      </form>
      {history.error !== null ? <ErrorState message={tr.dynamic(`teamAttendance.errors.${history.error}`, undefined, tr("teamAttendance.errors.generic"))} /> : (
        <>
          <TotalsSummary totals={teamTotals(pastRows)} />
          <Card>
            <CardHeader><CardTitle>{tr("adminAttendance.history.byDate")}</CardTitle></CardHeader>
            <CardBody><SessionHistoryList rows={pastRows} mode="team" /></CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>{tr("adminAttendance.history.byPlayer")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {(playerStats.data ?? []).length === 0 ? <p className="px-5 py-5 text-sm text-text-muted">{tr("adminAttendance.history.noFinal")}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead className="text-left text-xs text-text-muted">
                      <tr className="border-b border-border-soft">
                        <th className="px-5 py-2 font-medium">{LABELS.athlete}</th>
                        <th className="px-2 py-2 text-right font-medium">{tr("adminAttendance.totals.sessions")}</th>
                        <th className="px-2 py-2 text-right font-medium">{tr("adminAttendance.mark.present")}</th>
                        <th className="px-2 py-2 text-right font-medium">{tr("adminAttendance.mark.late")}</th>
                        <th className="px-2 py-2 text-right font-medium">{tr("adminAttendance.mark.excused")}</th>
                        <th className="px-2 py-2 text-right font-medium">{tr("adminAttendance.mark.unexcused")}</th>
                        <th className="px-5 py-2 text-right font-medium">{tr("adminAttendance.totals.rate")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(playerStats.data ?? []).map((p) => (
                        <tr key={p.athlete_id ?? p.team_id} className="border-b border-border-soft last:border-0">
                          <td className="px-5 py-2">
                            {p.athlete_id ? <Link href={`/admin/athletes/${p.athlete_id}?tab=attendance`} className="text-text hover:text-brand-primary">{p.first_name} {p.last_name}</Link> : "—"}
                          </td>
                          <td className="tnum px-2 py-2 text-right">{f.number(p.sessions)}</td>
                          <td className="tnum px-2 py-2 text-right">{f.number(p.present)}</td>
                          <td className="tnum px-2 py-2 text-right">{f.number(p.late)}</td>
                          <td className="tnum px-2 py-2 text-right">{f.number(p.excused)}</td>
                          <td className="tnum px-2 py-2 text-right">{f.number(p.unexcused)}</td>
                          <td className="tnum px-5 py-2 text-right">{p.rate === null ? "—" : f.percent(p.rate, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  ) : (
    <EmptyState title={tr("adminAttendance.team.adminOnly")} />
  );

  const tabs: ProfileTab[] = [
    { id: "roster", label: tr("adminAttendance.team.tabRoster"), content: rosterTab, count: rv?.roster.length ?? null },
    { id: "coaches", label: tr("adminAttendance.team.tabCoaches"), content: coachesTab, count: t.coaches.length },
    { id: "schedule", label: tr("adminAttendance.team.tabSchedule"), content: scheduleTab },
    ...(isAdmin ? [{ id: "attendance", label: tr("adminAttendance.team.tabAttendance"), content: attendanceTab }] : []),
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <CoverImage
        cover={cover}
        variant="banner"
        eyebrow={t.seasonName ?? undefined}
        title={t.name}
        subtitle={[t.sport, t.ageGroup, t.gender, t.level].filter(Boolean).join(" · ") || undefined}
        edit={isAdmin ? { target: "team", id: t.id, canUseLibrary: true } : null}
        priority
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {t.coaches.length === 0 && <Badge tone="warning">{tr("adminAttendance.team.noCoach")}</Badge>}
          {!t.isActive && <Badge>{tr("teamAdmin.list.archived")}</Badge>}
          {t.programName && t.programId && (
            <Link href={t.isSelectionProgram ? `/admin/selection/${t.programId}` : `/admin/programs/${t.programId}`}>
              <Badge tone={t.isSelectionProgram ? "accent" : "neutral"}>{tr("teamAdmin.team.programme", { name: t.programName })}</Badge>
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/schedule/new?team=${t.id}`}><Button size="sm" variant="secondary"><CalendarPlus className="h-4 w-4" /> {tr("media.team.addEvent")}</Button></Link>
          <Link href={`/admin/teams/${t.id}/edit`}><Button size="sm" variant="secondary"><Pencil className="h-4 w-4" /> {tr("common.edit")}</Button></Link>
          {isAdmin && !t.isActive && <RestoreTeamButton teamId={t.id} name={t.name} />}
          {isAdmin && <DeleteTeamButton teamId={t.id} name={t.name} redirectTo="/admin/teams" />}
        </div>
      </div>

      <SportTagPicker kind="team" recordId={t.id} value={sportId} sports={sports} />

      <ProfileTabs tabs={tabs} label={tr("adminAttendance.team.sectionsLabel")} initial={initialTab} param="tab" />

      {t.notes && <Card><CardBody><p className="whitespace-pre-wrap text-sm text-ink-2">{t.notes}</p></CardBody></Card>}
    </div>
  );
}

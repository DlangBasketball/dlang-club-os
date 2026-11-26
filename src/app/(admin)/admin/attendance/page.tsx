import Link from "next/link";
import { PageHeader, ErrorState, Input, Button, Card, CardBody } from "@/components/ui";
import { selectClass } from "@/components/teams/fields";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { HIDDEN_ATHLETE_STATUS_FILTER } from "@/lib/people/person-delete";
import { listTeams } from "@/lib/sportsops/data";
import { dateParam } from "@/lib/attendance/admin-stats";
import { getFollowups, getSessionsOverview, getSessionsRoster, overviewTotals, type OverviewScope } from "@/lib/attendance/overview";
import { FollowupsCard, SessionOverviewList, TotalsTiles, needsCompletion } from "@/components/attendance/admin/overview-views";
import { zonedDayKey } from "@/lib/staff/hours";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("attendance.title") };
}

type SP = { from?: string; to?: string; group?: string; athlete?: string };
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Attendance tab (admin). Reads the authoritative team sheets through ONE
 * SQL read (attendance_sessions_overview): team trainings and games, booked
 * sessions, and earlier programme sessions (read-only). Defaults to today in
 * the club time zone and all teams. Each session expands to its roster (the
 * roster of that session's date, or its bookings) with each player's current
 * status; the original session page is one click away for review /
 * correction. The Dashboard and the player profile use the same read.
 */
export default async function AdminAttendancePage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireRole(["admin"]);
  const [{ t, f }, sp] = await Promise.all([getI18n(), searchParams]);
  const today = zonedDayKey(new Date(), f.timeZone);
  let from = dateParam(sp.from) ?? today;
  let to = dateParam(sp.to) ?? from;
  if (to < from) [from, to] = [to, from];
  const group = sp.group ?? "";
  const teamId = UUID.test(group) ? group : null;
  const scope: OverviewScope = teamId ? "teams" : group === "teams" || group === "bookings" || group === "programs" ? group : "all";
  const athleteId = sp.athlete && UUID.test(sp.athlete) ? sp.athlete : null;

  const db = await createClient();
  const [res, teams, athletes, followups] = await Promise.all([
    getSessionsOverview({ from, to, teamId, athleteId, scope, limit: 300 }),
    listTeams(),
    db.from("athletes").select("id,first_name,last_name").not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER)
      .order("last_name").order("first_name").limit(1000),
    getFollowups("open", 50),
  ]);
  if (res.error !== null) {
    return (
      <div className="animate-fade-up">
        <PageHeader title={t("attendance.title")} />
        <ErrorState title={t("attendance.admin.loadError")} message={t.dynamic(`teamAttendance.errors.${res.error}`, undefined, t("teamAttendance.errors.generic"))} />
      </div>
    );
  }
  // Oldest first within the range (a day reads like the day's schedule).
  const rows = [...res.data].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const rosters = await getSessionsRoster(rows.slice(0, 100).map((r) => r.session_id));
  const totals = overviewTotals(rows);
  const toComplete = rows.filter((r) => needsCompletion(r));
  const isToday = from === today && to === today;

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("attendance.title")} description={t("attendanceOverview.description")}
        actions={<Link href="/admin/attendance/team" className="text-sm text-brand-primary hover:underline">{t("attendanceOverview.followupScreen")}</Link>} />

      <Card>
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-text-muted">{t("adminAttendance.filters.from")}
              <Input type="date" name="from" defaultValue={from} className="mt-1 h-9 w-40" />
            </label>
            <label className="text-xs text-text-muted">{t("adminAttendance.filters.to")}
              <Input type="date" name="to" defaultValue={to} className="mt-1 h-9 w-40" />
            </label>
            <label className="text-xs text-text-muted">{t("adminAttendance.filters.team")}
              <select name="group" defaultValue={group} className={`${selectClass} mt-1 h-9 w-52`}>
                <option value="">{t("adminAttendance.filters.allTeams")}</option>
                <option value="teams">{t("attendanceOverview.filters.teamsOnly")}</option>
                <option value="bookings">{t("attendanceOverview.filters.bookings")}</option>
                <option value="programs">{t("attendanceOverview.filters.programs")}</option>
                {(teams.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-text-muted">{t("attendanceOverview.filters.player")}
              <select name="athlete" defaultValue={athleteId ?? ""} className={`${selectClass} mt-1 h-9 w-52`}>
                <option value="">{t("attendanceOverview.filters.allPlayers")}</option>
                {(athletes.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.last_name} {a.first_name}</option>)}
              </select>
            </label>
            <Button type="submit" size="sm" variant="secondary">{t("adminAttendance.filters.apply")}</Button>
            {!isToday && <Link href="/admin/attendance" className="text-xs text-brand-primary hover:underline">{t("attendanceOverview.filters.today")}</Link>}
          </form>
        </CardBody>
      </Card>

      <section className="space-y-2" aria-labelledby="att-totals">
        <h2 id="att-totals" className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {isToday ? t("attendanceOverview.todayHeading", { date: f.date(today, { weekday: true }) })
            : t("attendanceOverview.rangeHeading", { from: f.date(from), to: f.date(to) })}
        </h2>
        <TotalsTiles t={t} f={f} totals={totals} />
        <p className="text-xs text-text-muted">{t("attendanceOverview.statusRule")}</p>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <SessionOverviewList t={t} f={f} rows={rows} rosters={rosters.data ?? new Map()} showDate={from !== to} />
        <FollowupsCard t={t} f={f} followups={followups.data ?? []} toComplete={toComplete} />
      </div>
      {rows.length >= 300 && <p className="text-xs text-text-muted">{t("attendanceOverview.truncated")}</p>}
    </div>
  );
}

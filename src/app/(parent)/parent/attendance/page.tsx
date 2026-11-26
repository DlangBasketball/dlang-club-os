import Link from "next/link";
import { Users } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { athleteFilterFor } from "@/lib/participants/my-athletes";
import { cn } from "@/lib/utils";
import { attendancePortalPath } from "@/lib/attendance/types";
import { uuidParam } from "@/lib/attendance/family";
import { getFamilyOverview, getMyChildren, type FamilyOverview, type HistoryEntry } from "@/lib/attendance/family-data";
import { getGuardianBookings } from "@/lib/booking/data";
import { mergeAttendanceHistory } from "@/lib/booking/portal";
import { AttendanceHistory, UpcomingSessions } from "@/components/attendance/family/sections";

type SP = { athlete?: string; team?: string; season?: string };

/**
 * Parent attendance: per linked child, upcoming team sessions (report an
 * absence) and booked private / group sessions, the finalized attendance
 * record (team / season filters, totals; booked sessions merged in from the
 * booking overview) and correction requests. Only the guardian's own children are listed; the
 * overview RPC re-checks guardianship on the server.
 */
export default async function ParentAttendancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, f }, user] = await Promise.all([getI18n(), getSessionUser()]);
  const kids = user?.orgId ? await getMyChildren(user.id, user.orgId) : [];

  if (!kids.length) {
    return (
      <div className="animate-fade-up space-y-5">
        <PageHeader title={t("familyAttendance.title")} description={t("familyAttendance.description")} />
        <EmptyState icon={<Users className="h-5 w-5" />} title={t("familyAttendance.noChildren.title")} description={t("familyAttendance.noChildren.body")} />
      </div>
    );
  }

  // Explicit ?athlete=, else the active athlete of the switcher (validated), else the first child.
  const filter = await athleteFilterFor(uuidParam(sp.athlete), { allowAll: false });
  const wanted = filter.mode === "one" ? filter.athleteId : null;
  const child = kids.find((k) => k.id === wanted) ?? kids[0];
  const [rawOverview, legacy, bookings] = await Promise.all([getFamilyOverview(child.id), programmeSessions(child.id), getGuardianBookings(child.id)]);
  const overview = withBookedSessions(rawOverview, bookings.data?.[0]?.attendance ?? []);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("familyAttendance.title")} description={t("familyAttendance.description")} />

      {kids.length > 1 && (
        <nav aria-label={t("familyAttendance.childTabs")} className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
          {kids.map((k) => (
            <Link key={k.id} href={`/parent/attendance?athlete=${k.id}`} aria-current={k.id === child.id ? "page" : undefined}
              className={cn("flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm transition-colors",
                k.id === child.id ? "bg-brand-primary-soft text-text" : "text-text-muted hover:text-text")}>
              {k.first_name} {k.last_name}
            </Link>
          ))}
        </nav>
      )}

      {overview.error || !overview.data ? (
        <ErrorState title={t("familyAttendance.title")} message={t("familyAttendance.loadError")} />
      ) : (
        <>
          <UpcomingSessions overview={overview.data} athleteId={child.id} />
          <AttendanceHistory overview={overview.data} basePath="/parent/attendance" hidden={{ athlete: child.id }}
            teamId={uuidParam(sp.team)} seasonId={uuidParam(sp.season)} recordLinks />

          {overview.data.correction_requests.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t("familyAttendance.correction.requests")}</CardTitle></CardHeader>
              <CardBody className="p-0">
                <ul>
                  {overview.data.correction_requests.slice(0, 10).map((q) => (
                    <li key={q.request_id} className="border-b border-border last:border-0">
                      <Link href={attendancePortalPath(q.event_id, child.id)}
                        className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-elevated">
                        <span className="text-sm text-text">{t("familyAttendance.correction.sentOn", { date: f.date(q.created_at) })}</span>
                        <Badge tone={q.status === "accepted" ? "success" : q.status === "rejected" ? "danger" : q.status === "open" ? "info" : "neutral"}>
                          {t.dynamic(`familyAttendance.correction.status.${q.status}`, undefined, q.status)}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {legacy.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("familyAttendance.programmes.title")}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <ul>
              {legacy.map((r, i) => (
                <li key={i} className="flex items-center justify-between border-b border-border px-5 py-3 last:border-0">
                  <div>
                    <div className="text-sm text-text">{r.program_name ?? t("familyAttendance.programmes.session")}</div>
                    <div className="text-xs text-text-muted">{f.date(r.session_date)}</div>
                  </div>
                  <Badge tone={statusTone(r.status)}>{t.dynamic(`attendance.${r.status}`, undefined, r.status)}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/** Adds finalized booked sessions the attendance overview did not return (one row per event). */
function withBookedSessions<R extends { data: FamilyOverview | null }>(
  read: R,
  booked: { event_id: string; service_name: string; starts_at: string; status: string }[],
): R {
  if (!read.data || booked.length === 0) return read;
  const history = mergeAttendanceHistory<HistoryEntry>(read.data.history, booked, (a) => ({
    event_id: a.event_id, team_id: null, team_name: a.service_name, type: "training", starts_at: a.starts_at, status: a.status,
    is_guest: false, season_id: null, season_name: null, can_request_correction: false, open_request: false, alert: null, booked: true,
  }));
  return { ...read, data: { ...read.data, history } };
}

/** Programme-session attendance (earlier attendance module), as before. */
async function programmeSessions(athleteId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("athlete_attendance_summary", { p_athlete: athleteId });
  return (data ?? []) as { session_date: string; program_name: string | null; status: string }[];
}

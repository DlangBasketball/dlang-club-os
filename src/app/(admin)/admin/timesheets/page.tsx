import Link from "next/link";
import { AlertTriangle, CalendarClock, Download, Users } from "lucide-react";
import { PageHeader, Card, Badge, Button, EmptyState, ErrorState } from "@/components/ui";
import { PeriodToolbar } from "@/components/staff/period-toolbar";
import { MissedCheckButton, TimesheetApproval } from "@/components/staff/timesheet-actions";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { countMissedClockOuts, getStaffHours } from "@/lib/staff/data";
import { formatMinutes, zonedDayKey } from "@/lib/staff/hours";
import { parsePeriod } from "@/lib/staff/period";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.timesheets.title") };
}

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string }> }) {
  const me = await requireRole(["admin", "finance"]);
  const [{ t, f }, sp] = await Promise.all([getI18n(), searchParams]);
  const orgId = me.orgId as string;
  const period = parsePeriod(sp, zonedDayKey(new Date(), f.timeZone));
  const isAdmin = me.roles.includes("admin");
  const [hours, missed] = await Promise.all([getStaffHours(orgId, period.from, period.to), countMissedClockOuts(orgId)]);
  const rows = hours.data ?? [];
  const totals = rows.reduce((a, r) => ({ planned: a.planned + r.planned_minutes, worked: a.worked + r.worked_minutes }), { planned: 0, worked: 0 });

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title={t("staff.timesheets.title")}
        description={t("staff.timesheets.description")}
        actions={<>
          {isAdmin && <Link href="/admin/staff-schedules"><Button size="sm" variant="secondary"><CalendarClock className="h-4 w-4" /> {t("staff.schedules.title")}</Button></Link>}
          <a href={`/admin/timesheets/export?from=${period.from}&to=${period.to}`}><Button size="sm" variant="secondary"><Download className="h-4 w-4" /> {t("staff.timesheets.exportCsv")}</Button></a>
          {isAdmin && <MissedCheckButton />}
        </>}
      />
      <PeriodToolbar basePath="/admin/timesheets" period={period} f={f} t={t} />
      {missed > 0 && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-text">
          <AlertTriangle className="h-4 w-4 text-warning" /> {t("staff.timesheets.missedBanner", { count: missed })}
        </div>
      )}
      {hours.error !== null ? (
        <ErrorState title={t("staff.errors.generic")} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users />} title={t("staff.timesheets.noEmployees")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-text-muted">
                <th className="px-4 py-3 font-medium">{t("staff.timesheets.employee")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("staff.timesheets.planned")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("staff.timesheets.worked")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("staff.timesheets.difference")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("staff.timesheets.breaks")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("staff.timesheets.entries")}</th>
                <th className="px-4 py-3 font-medium">{t("staff.timesheets.status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.worked_minutes - r.planned_minutes;
                return (
                  <tr key={r.profile_id} className="border-b border-border-soft last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/admin/timesheets/${r.profile_id}?period=${period.kind}&from=${period.from}`} className="font-medium text-text hover:underline">
                        {r.full_name ?? "—"}
                      </Link>
                    </td>
                    <td className="tnum px-4 py-3 text-right text-text-muted">{formatMinutes(r.planned_minutes)}</td>
                    <td className="tnum px-4 py-3 text-right text-text">{formatMinutes(r.worked_minutes)}</td>
                    <td className={cn("tnum px-4 py-3 text-right", diff < 0 ? "text-warning" : diff > 0 ? "text-success" : "text-text-muted")}>
                      {diff > 0 ? "+" : ""}{formatMinutes(diff)}
                    </td>
                    <td className="tnum px-4 py-3 text-right text-text-muted">{formatMinutes(r.break_minutes)}</td>
                    <td className="tnum px-4 py-3 text-right text-text-muted">{r.entry_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={r.approved ? "success" : "neutral"}>{r.approved ? t("staff.timesheets.approved") : t("staff.timesheets.pending")}</Badge>
                        {r.open_entries > 0 && <Badge tone="info">{t("staff.timesheets.open", { count: r.open_entries })}</Badge>}
                        {r.missed_entries > 0 && <Badge tone="danger">{t("staff.timesheets.missed", { count: r.missed_entries })}</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && (
                        <TimesheetApproval profileId={r.profile_id} from={period.from} to={period.to} approved={r.approved}
                          disabled={!r.approved && (r.open_entries > 0 || r.missed_entries > 0)} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border text-text">
                <td className="px-4 py-3 font-medium">{t("staff.timesheets.total")}</td>
                <td className="tnum px-4 py-3 text-right">{formatMinutes(totals.planned)}</td>
                <td className="tnum px-4 py-3 text-right">{formatMinutes(totals.worked)}</td>
                <td className="tnum px-4 py-3 text-right">{formatMinutes(totals.worked - totals.planned)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  );
}

import { notFound } from "next/navigation";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, StatCard, StatGrid, Badge } from "@/components/ui";
import { PeriodToolbar } from "@/components/staff/period-toolbar";
import { AdminEntries, type EntryLocal } from "@/components/staff/admin-entries";
import { EntryList } from "@/components/staff/entry-list";
import { TimesheetApproval } from "@/components/staff/timesheet-actions";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getStaffHours, listEntries, listShiftTemplates, listTimesheets, listVenuesGeo } from "@/lib/staff/data";
import { expandShiftTemplates, formatMinutes, zonedDayKey, zonedParts } from "@/lib/staff/hours";
import { parsePeriod } from "@/lib/staff/period";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.timesheets.title") };
}

export default async function EmployeeTimesheetPage({
  params, searchParams,
}: { params: Promise<{ profileId: string }>; searchParams: Promise<{ period?: string; from?: string }> }) {
  const me = await requireRole(["admin", "finance"]);
  const [{ t, f }, { profileId }, sp] = await Promise.all([getI18n(), params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) notFound();
  const orgId = me.orgId as string;
  const tz = f.timeZone;
  const period = parsePeriod(sp, zonedDayKey(new Date(), tz));
  const [hours, entries, templates, sheets, venues] = await Promise.all([
    getStaffHours(orgId, period.from, period.to),
    listEntries(orgId, profileId, period.from, period.to, tz, "admin"),
    listShiftTemplates(orgId, profileId),
    listTimesheets(orgId, profileId, period.from, period.to),
    listVenuesGeo(orgId),
  ]);
  const row = (hours.data ?? []).find((r) => r.profile_id === profileId);
  if (!row) notFound();
  const isAdmin = me.roles.includes("admin");
  const planned = expandShiftTemplates(templates.data ?? [], period.from, period.to, tz);
  const venueName = new Map(venues.map((v) => [v.id, v.name]));
  const local: Record<string, EntryLocal> = {};
  for (const e of entries.data ?? []) {
    const a = zonedParts(e.clockInAt, tz);
    const b = e.clockOutAt ? zonedParts(e.clockOutAt, tz) : null;
    local[e.id] = {
      clockIn: `${a.date}T${a.time}`,
      clockOut: b ? `${b.date}T${b.time}` : "",
      breaks: e.breaks.filter((x) => x.endedAt).map((x) => {
        const s = zonedParts(x.startedAt, tz);
        const en = zonedParts(x.endedAt as string, tz);
        return { start: `${s.date}T${s.time}`, end: `${en.date}T${en.time}` };
      }),
    };
  }
  const base = `/admin/timesheets/${profileId}`;

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        eyebrow={t("staff.timesheets.title")}
        title={row.full_name ?? "—"}
        actions={isAdmin ? (
          <TimesheetApproval profileId={profileId} from={period.from} to={period.to} approved={row.approved}
            disabled={!row.approved && (row.open_entries > 0 || row.missed_entries > 0)} />
        ) : undefined}
      />
      <PeriodToolbar basePath={base} period={period} f={f} t={t} />
      <StatGrid>
        <StatCard label={t("staff.timesheets.planned")} value={formatMinutes(row.planned_minutes)} />
        <StatCard label={t("staff.timesheets.worked")} value={formatMinutes(row.worked_minutes)} tone="success" />
        <StatCard label={t("staff.timesheets.difference")} value={formatMinutes(row.worked_minutes - row.planned_minutes)}
          tone={row.worked_minutes < row.planned_minutes ? "warning" : "brand"} />
        <StatCard label={t("staff.timesheets.breaks")} value={formatMinutes(row.break_minutes)} />
      </StatGrid>
      {sheets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sheets.map((s) => (
            <Badge key={s.id} tone={s.status === "approved" ? "success" : "neutral"}>
              {f.date(s.periodStart)} – {f.date(s.periodEnd)} · {s.status === "approved" ? t("staff.timesheets.approved") : t("staff.timesheets.reopened")}
            </Badge>
          ))}
        </div>
      )}
      <Card>
        <CardHeader><CardTitle>{t("staff.timesheets.viewEntries")}</CardTitle></CardHeader>
        <CardBody>
          {isAdmin ? (
            <AdminEntries profileId={profileId} entries={entries.data ?? []} local={local}
              venues={venues.filter((v) => v.isActive).map((v) => ({ id: v.id, name: v.name }))}
              locked={row.approved} defaultDay={period.from} />
          ) : (entries.data ?? []).length ? <EntryList entries={entries.data ?? []} /> : <p className="text-sm text-text-muted">{t("staff.timesheets.detail.noEntries")}</p>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("staff.clock.planned")}</CardTitle></CardHeader>
        <CardBody>
          {planned.length === 0 ? <p className="text-sm text-text-muted">{t("staff.clock.noPlanned")}</p> : (
            <ul className="space-y-1.5 text-sm">
              {planned.map((s) => (
                <li key={`${s.templateId}-${s.dayKey}`} className="flex flex-wrap justify-between gap-2">
                  <span className="text-text">{f.date(s.start, { weekday: true })}</span>
                  <span className="tnum text-text-muted">{f.time(s.start)}–{f.time(s.end)}{s.venueId && venueName.get(s.venueId) ? ` · ${venueName.get(s.venueId)}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

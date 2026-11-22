import Link from "next/link";
import { CheckSquare, AlertTriangle } from "lucide-react";
import { PageHeader, DataTable, Badge, statusTone, EmptyState, ErrorState, Input, Avatar, Button, type Column } from "@/components/ui";
import { Pager, pageParam } from "@/components/ui/pager";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { listAttendanceSessions, type AttendanceSessionRow } from "@/lib/data/attendance-admin";
import { getI18n } from "@/lib/i18n/server";

export default async function AdminAttendancePage({ searchParams }: { searchParams: Promise<{ date?: string; page?: string }> }) {
  const { t, f } = await getI18n();
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined;
  const page = pageParam(sp.page);
  const res = await listAttendanceSessions(date, { page, timeZone: f.timeZone });
  if (res.error) return (<div className="animate-fade-up"><PageHeader title={t("attendance.title")} /><ErrorState title={t("attendance.admin.loadError")} message={res.error} /></div>);
  const rows = res.data!;
  const coachPhotos = await photoUrlsForCoaches(rows.map((r) => r.coachId));

  const columns: Column<AttendanceSessionRow>[] = [
    { key: "programName", header: t("attendance.admin.colSession"), render: (r) => <Link href={`/admin/attendance/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.programName || t("attendance.admin.untitled")}</Link> },
    { key: "coachName", header: t("attendance.admin.colCoach"), render: (r) => r.coachId ? <span className="flex items-center gap-2"><Avatar name={r.coachName} src={coachPhotos[r.coachId] ?? null} size="sm" />{r.coachName}</span> : r.coachName },
    { key: "date", header: t("attendance.admin.colDate"), render: (r) => `${f.date(r.date)} ${f.time(r.date)}` },
    { key: "present", header: t("attendance.admin.colCounts"), render: (r) => (
      <span className="text-xs">
        {t("attendance.admin.counts", { present: r.present, late: r.late, absent: r.absent, excused: r.excused })}
        {r.injuries > 0 && <span className="ml-2 inline-flex items-center gap-0.5 text-danger"><AlertTriangle className="h-3 w-3" />{r.injuries}</span>}
      </span>
    ) },
    { key: "status", header: t("attendance.admin.colStatus"), render: (r) => <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status)}</Badge> },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title={t("attendance.title")} description={t("attendance.admin.description")}
        actions={
          <form method="get" className="flex items-center gap-2">
            <Input type="date" name="date" defaultValue={date} className="w-44" aria-label={t("attendance.admin.colDate")} />
            <Button type="submit" size="sm" variant="secondary">{t("attendance.admin.filterDate")}</Button>
            {date && <Link href="/admin/attendance" className="text-xs text-maroon hover:underline">{t("attendance.admin.clear")}</Link>}
          </form>
        } />
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={<EmptyState icon={<CheckSquare className="h-5 w-5" />} title={t("attendance.admin.emptyTitle")} description={t("attendance.admin.emptyBody")} />} />
      <Pager basePath="/admin/attendance" params={{ date }} page={page} hasMore={Boolean(res.hasMore)} />
    </div>
  );
}

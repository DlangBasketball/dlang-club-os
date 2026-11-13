import Link from "next/link";
import { CheckSquare, AlertTriangle } from "lucide-react";
import { PageHeader, DataTable, Badge, statusTone, EmptyState, ErrorState, Input, Avatar, type Column } from "@/components/ui";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { listAttendanceSessions, type AttendanceSessionRow } from "@/lib/data/attendance-admin";
import { getFormatter } from "@/lib/i18n/server";

export default async function AdminAttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const f = await getFormatter();
  const { date } = await searchParams;
  const { data, error } = await listAttendanceSessions(date);
  if (error) return (<div className="animate-fade-up"><PageHeader title="Attendance" /><ErrorState title="Couldn't load" message={error} /></div>);
  const rows = data!;
  const coachPhotos = await photoUrlsForCoaches(rows.map((r) => r.coachId));

  const columns: Column<AttendanceSessionRow>[] = [
    { key: "programName", header: "Session", render: (r) => <Link href={`/admin/attendance/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.programName}</Link> },
    { key: "coachName", header: "Coach", render: (r) => r.coachId ? <span className="flex items-center gap-2"><Avatar name={r.coachName} src={coachPhotos[r.coachId] ?? null} size="sm" />{r.coachName}</span> : r.coachName },
    { key: "date", header: "Date", render: (r) => `${f.date(r.date)} ${f.time(r.date)}` },
    { key: "present", header: "Counts", render: (r) => (
      <span className="text-xs">
        <span className="text-success">{r.present}P</span> · <span className="text-warning">{r.late}L</span> · <span className="text-danger">{r.absent}A</span> · {r.excused}E
        {r.injuries > 0 && <span className="ml-2 inline-flex items-center gap-0.5 text-danger"><AlertTriangle className="h-3 w-3" />{r.injuries}</span>}
      </span>
    ) },
    { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Attendance" description="Review attendance by session, coach and date."
        actions={<form><Input type="date" name="date" defaultValue={date} className="w-44" /></form>} />
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={<EmptyState icon={<CheckSquare className="h-5 w-5" />} title="No attendance recorded" description="Sessions appear here once coaches submit." />} />
    </div>
  );
}

import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, statusTone, ErrorState } from "@/components/ui";
import { getAttendanceSessionDetail } from "@/lib/data/attendance-admin";
import { getFormatter } from "@/lib/i18n/server";

export default async function AdminAttendanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const f = await getFormatter();
  const { id } = await params;
  const { data, error } = await getAttendanceSessionDetail(id);
  if (error) return <ErrorState title="Couldn't load" message={error} />;
  if (!data) notFound();

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={data.programName} description={`${data.coachName} · ${f.date(data.date)} ${f.time(data.date)}`}
        actions={<Badge tone={statusTone(data.status)}>{data.status}</Badge>} />
      <Card>
        <CardBody className="p-0">
          <ul>
            {data.marks.map((m) => (
              <li key={m.athleteId} className="border-b border-line-soft px-5 py-3 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-ink">{m.name}{m.injury && <AlertTriangle className="h-4 w-4 text-danger" />}</span>
                  <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                </div>
                {m.notes && <p className="mt-1 text-xs text-ink-3">Note: {m.notes}</p>}
              </li>
            ))}
            {data.marks.length === 0 && <li className="px-5 py-6 text-center text-sm text-ink-3">No marks recorded.</li>}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

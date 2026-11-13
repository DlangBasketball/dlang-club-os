import { CheckSquare } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getFormatter } from "@/lib/i18n/server";

export default async function ParentAttendancePage() {
  const f = await getFormatter();
  const supabase = await createClient();
  // RLS scopes athletes to the guardian's own children.
  const { data: kids } = await supabase.from("athletes").select("id,first_name,last_name").order("first_name");

  const summaries = await Promise.all(
    (kids ?? []).map(async (k) => {
      const { data } = await supabase.rpc("athlete_attendance_summary", { p_athlete: k.id });
      return { name: `${k.first_name} ${k.last_name}`, rows: (data ?? []) as { session_date: string; program_name: string | null; status: string }[] };
    }),
  );
  const anyRows = summaries.some((s) => s.rows.length > 0);

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Attendance" description="Attendance for your children, once published by the club." />
      {!anyRows ? (
        <EmptyState icon={<CheckSquare className="h-5 w-5" />} title="No attendance to show yet" description="Summaries appear here when the club publishes them." />
      ) : (
        summaries.filter((s) => s.rows.length > 0).map((s) => (
          <Card key={s.name}>
            <CardHeader><CardTitle>{s.name}</CardTitle></CardHeader>
            <CardBody className="p-0">
              <ul>
                {s.rows.map((r, i) => (
                  <li key={i} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                    <div><div className="text-sm text-ink">{r.program_name ?? "Session"}</div><div className="text-xs text-ink-3">{f.date(r.session_date)}</div></div>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}

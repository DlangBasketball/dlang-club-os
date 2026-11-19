import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, ErrorState, SkeletonCard } from "@/components/ui";
import { getTodaysAttendance } from "@/lib/data/dashboard";

export async function TodaysAttendance() {
  const { data, error } = await getTodaysAttendance();
  if (error) return <ErrorState title="Couldn't load attendance" message={error} />;
  const a = data!;
  const cells = [
    { label: "Sessions", value: a.total, tone: "text-ink" },
    { label: "Submitted", value: a.submitted, tone: "text-success" },
    { label: "Open", value: a.open, tone: "text-warning" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s attendance</CardTitle>
        <Link href="/admin/attendance" className="text-xs text-maroon hover:underline">Open</Link>
      </CardHeader>
      <CardBody>
        {a.total === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-ink-3">
            <CheckSquare className="h-4 w-4" /> No sessions scheduled today.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {cells.map((c) => (
              <div key={c.label} className="rounded-md bg-surface-elevated px-3 py-4 text-center">
                <div className={`tnum text-2xl font-semibold ${c.tone}`}>{c.value}</div>
                <div className="mt-1 text-xs text-ink-3">{c.label}</div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as TodaysAttendanceSkeleton };

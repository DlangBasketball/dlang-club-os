import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState, SkeletonCard } from "@/components/ui";
import { getRecentRegistrations } from "@/lib/data/dashboard";
import { timeAgo } from "@/lib/utils";

export async function RegistrationSummary() {
  const { data, error } = await getRecentRegistrations(6);
  if (error) return <ErrorState title="Couldn't load registrations" message={error} />;
  const regs = data!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent registrations</CardTitle>
        <Link href="/admin/registrations" className="text-xs text-maroon hover:underline">View all</Link>
      </CardHeader>
      <CardBody className="p-0">
        {regs.length === 0 ? (
          <div className="p-5"><EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No registrations yet" /></div>
        ) : (
          <ul>
            {regs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{r.athleteName}</div>
                  <div className="truncate text-xs text-ink-3">{r.programName} · {timeAgo(r.createdAt)}</div>
                </div>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as RegistrationSummarySkeleton };

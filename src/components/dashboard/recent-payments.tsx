import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState, SkeletonCard } from "@/components/ui";
import { getRecentPayments } from "@/lib/data/dashboard";
import { formatCHF, timeAgo } from "@/lib/utils";

export async function RecentPayments() {
  const { data, error } = await getRecentPayments(5);
  if (error) return <ErrorState title="Couldn't load payments" message={error} />;
  const payments = data!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent payments</CardTitle>
        <Link href="/admin/payments" className="text-xs text-maroon hover:underline">View all</Link>
      </CardHeader>
      <CardBody className="p-0">
        {payments.length === 0 ? (
          <div className="p-5"><EmptyState icon={<CreditCard className="h-5 w-5" />} title="No payments yet" /></div>
        ) : (
          <ul>
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{p.familyName}</div>
                  <div className="truncate text-xs text-ink-3">
                    <span className="tnum">{p.invoiceNumber}</span> · {p.method} · {timeAgo(p.when)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tnum text-sm font-medium text-ink">{formatCHF(p.amount)}</span>
                  <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as RecentPaymentsSkeleton };

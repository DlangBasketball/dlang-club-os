import Link from "next/link";
import { Card, CardHeader, CardTitle, CardBody, ErrorState, SkeletonCard } from "@/components/ui";
import { getInvoiceSummary } from "@/lib/data/dashboard";
import { getFormatter } from "@/lib/i18n/server";

export async function InvoiceSummary() {
  const f = await getFormatter();
  const { data, error } = await getInvoiceSummary();
  if (error) return <ErrorState title="Couldn't load invoices" message={error} />;
  const s = data!;
  const rows = [
    { label: "Open", count: s.open.count, total: s.open.total, tone: "text-ink" },
    { label: "Overdue", count: s.overdue.count, total: s.overdue.total, tone: "text-danger" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <Link href="/admin/invoices" className="text-xs text-maroon hover:underline">Manage</Link>
      </CardHeader>
      <CardBody className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between rounded-md bg-surface-elevated px-4 py-3">
            <div>
              <div className={`text-sm font-medium ${r.tone}`}>{r.label}</div>
              <div className="text-xs text-ink-3">{r.count} invoice{r.count === 1 ? "" : "s"}</div>
            </div>
            <div className="tnum text-lg font-semibold">{f.money(r.total)}</div>
          </div>
        ))}
        <div className="flex items-center justify-between px-1 pt-1 text-xs text-ink-3">
          <span>Paid (all time)</span>
          <span className="tnum text-ink-2">{s.paidCount}</span>
        </div>
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as InvoiceSummarySkeleton };

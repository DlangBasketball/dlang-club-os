import Link from "next/link";
import { Landmark } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, statusTone, EmptyState, ErrorState } from "@/components/ui";
import { listAwaitingPayment } from "@/lib/data/reconciliation";
import { MarkPaidButton } from "@/components/invoice/mark-paid-button";
import { formatDate } from "@/lib/utils";
import { getFormatter } from "@/lib/i18n/server";

export default async function ReconcilePage() {
  const f = await getFormatter();
  const { data, error } = await listAwaitingPayment();
  if (error) return (<div className="animate-fade-up"><PageHeader title="Reconciliation" /><ErrorState title="Couldn't load" message={error} /></div>);
  const rows = data!;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Payment reconciliation" description="Match incoming TWINT / bank transfers to invoices by reference, then mark them paid." />
      {rows.length === 0 ? (
        <EmptyState icon={<Landmark className="h-5 w-5" />} title="Nothing awaiting payment" description="All issued invoices are settled." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardBody className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/invoices/${r.id}`} className="tnum font-medium text-ink hover:text-maroon">{r.number}</Link>
                    <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge>
                  </div>
                  <div className="text-sm text-ink-2">{r.familyName}</div>
                  <div className="mt-1 text-xs text-ink-3">Ref <span className="tnum text-ink-2">{r.reference}</span> · due {formatDate(r.dueDate)}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="tnum text-sm font-medium text-ink">{f.money(r.balance)}</div>
                    {r.paid > 0 && <div className="text-xs text-ink-3">of {f.money(r.total)}</div>}
                  </div>
                  <MarkPaidButton invoiceId={r.id} />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

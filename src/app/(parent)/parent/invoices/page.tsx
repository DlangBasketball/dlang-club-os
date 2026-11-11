import Link from "next/link";
import { Receipt } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, statusTone, EmptyState, ErrorState } from "@/components/ui";
import { listInvoices } from "@/lib/data/invoices";
import { formatCHF, formatDate } from "@/lib/utils";

export default async function ParentInvoicesPage() {
  const { data, error } = await listInvoices("all"); // RLS scopes to the parent's family
  if (error) return (<div className="animate-fade-up"><PageHeader title="Invoices" /><ErrorState title="Couldn't load invoices" message={error} /></div>);
  const rows = data!;
  const open = rows.filter((r) => r.balance > 0 && r.status !== "cancelled");
  const settled = rows.filter((r) => r.balance <= 0 || r.status === "cancelled");

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Invoices" description="View and pay your club invoices." />

      {rows.length === 0 ? (
        <EmptyState icon={<Receipt className="h-5 w-5" />} title="No invoices" description="You're all caught up." />
      ) : (
        <>
          {open.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-ink-2">Open</h2>
              <div className="space-y-2">
                {open.map((r) => (
                  <Link key={r.id} href={`/parent/invoices/${r.id}`} className="block">
                    <Card className="transition hover:border-maroon/40">
                      <CardBody className="flex items-center justify-between py-4">
                        <div>
                          <div className="tnum font-medium text-ink">{r.number}</div>
                          <div className="text-xs text-ink-3">Due {formatDate(r.dueDate)}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="tnum text-sm text-ink">{formatCHF(r.balance)}</span>
                          <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge>
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {settled.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-ink-2">Settled</h2>
              <div className="space-y-2">
                {settled.map((r) => (
                  <Link key={r.id} href={`/parent/invoices/${r.id}`} className="block">
                    <Card className="opacity-80 transition hover:opacity-100">
                      <CardBody className="flex items-center justify-between py-3">
                        <span className="tnum text-sm text-ink-2">{r.number}</span>
                        <div className="flex items-center gap-3">
                          <span className="tnum text-sm text-ink-3">{formatCHF(r.total)}</span>
                          <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge>
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

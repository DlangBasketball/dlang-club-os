import Link from "next/link";
import { CreditCard } from "lucide-react";
import { PageHeader, DataTable, EmptyState, ErrorState, Badge, statusTone, Card, CardBody, type Column } from "@/components/ui";
import { listPayments, collectedByCurrency, PAYMENT_FILTERS, type PaymentFilter, type PaymentRow } from "@/lib/data/payments-admin";
import { getFormatter } from "@/lib/i18n/server";
import { METHOD_INFO, isKnownMethod } from "@/lib/payments/methods";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const f = await getFormatter();
  const { status } = await searchParams;
  const filter: PaymentFilter = (PAYMENT_FILTERS as readonly string[]).includes(status ?? "") ? (status as PaymentFilter) : "all";
  const { data, error } = await listPayments(filter);
  if (error) return (<div className="animate-fade-up"><PageHeader title="Payments" /><ErrorState title="Couldn't load payments" message={error} /></div>);
  const rows = data!;
  const totals = collectedByCurrency(rows);

  const columns: Column<PaymentRow>[] = [
    { key: "invoiceNumber", header: "Invoice", render: (r) => <Link href={`/admin/invoices/${r.invoiceId}`} className="tnum font-medium text-ink hover:text-maroon">{r.invoiceNumber}</Link> },
    { key: "method", header: "Method", render: (r) => (isKnownMethod(r.method) ? METHOD_INFO[r.method].label : r.method) },
    { key: "at", header: "Date", render: (r) => f.date(r.at) },
    { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge> },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="tnum">{f.money(r.amount, r.currency)}</span> },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Payments" description="Status updates only from verified Stripe webhooks — never the client." />
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-2 py-3">
          {PAYMENT_FILTERS.map((k) => (
            <Link key={k} href={`/admin/payments?status=${k}`}
              className={`rounded-full px-3 py-1 text-xs ${filter === k ? "bg-maroon-soft text-maroon" : "bg-surface-elevated text-ink-3 hover:text-ink"}`}>
              {k}
            </Link>
          ))}
          {totals.length > 0 && (
            <span className="ml-auto text-xs text-ink-3">
              Total collected: {totals.map((t) => <span key={t.currency} className="tnum ml-1 text-ink">{f.money(t.amount, t.currency)}</span>)}
            </span>
          )}
        </CardBody>
      </Card>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={<EmptyState icon={<CreditCard className="h-5 w-5" />} title="No payments yet" />} />
    </div>
  );
}

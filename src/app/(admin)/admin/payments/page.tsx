import Link from "next/link";
import { CreditCard } from "lucide-react";
import { PageHeader, DataTable, EmptyState, ErrorState, Badge, statusTone, Card, CardBody, type Column } from "@/components/ui";
import { listPayments, collectedByCurrency, PAYMENT_FILTERS, type PaymentFilter, type PaymentRow } from "@/lib/data/payments-admin";
import { listReallocationTargets, type ReallocationTarget } from "@/lib/data/money-edit";
import { getFormatter, getTranslations } from "@/lib/i18n/server";
import { METHOD_INFO, isKnownMethod } from "@/lib/payments/methods";
import { PaymentBadges, PaymentRowActions } from "@/components/money/money-panels";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [f, t] = await Promise.all([getFormatter(), getTranslations()]);
  const { status } = await searchParams;
  const filter: PaymentFilter = (PAYMENT_FILTERS as readonly string[]).includes(status ?? "") ? (status as PaymentFilter) : "all";
  const { data, error } = await listPayments(filter);
  if (error) return (<div className="animate-fade-up"><PageHeader title="Payments" /><ErrorState title="Couldn't load payments" message={error} /></div>);
  const rows = data!;
  const totals = collectedByCurrency(rows);

  // Open invoices per currency, for re-allocating manual payments.
  const currencies = Array.from(new Set(rows.filter((r) => r.canEdit).map((r) => r.currency)));
  const targetsByCurrency = new Map<string, ReallocationTarget[]>(
    await Promise.all(currencies.map(async (c) => [c, await listReallocationTargets(c)] as const)),
  );

  const columns: Column<PaymentRow>[] = [
    { key: "invoiceNumber", header: "Invoice", render: (r) => <Link href={`/admin/invoices/${r.invoiceId}`} className="tnum font-medium text-ink hover:text-maroon">{r.invoiceNumber}</Link> },
    {
      key: "method",
      header: "Method",
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          {isKnownMethod(r.method) ? METHOD_INFO[r.method].label : r.method}
          <PaymentBadges voided={Boolean(r.voidedAt)} isReversal={r.isReversal} methodDetail={r.methodDetail} isStripe={r.isStripe} />
        </span>
      ),
    },
    { key: "at", header: "Date", render: (r) => f.date(r.at) },
    { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => <span className={`tnum ${r.voidedAt ? "text-ink-3 line-through" : ""}`}>{f.money(r.amount, r.currency)}</span>,
    },
    {
      key: "id",
      header: t("editMoney.common.actions"),
      align: "right",
      render: (r) => (
        <PaymentRowActions
          payment={{
            id: r.id, amount: r.amount, method: r.method, reference: r.reference, paidAt: r.at, notes: r.notes,
            adminNote: r.adminNote, isStripe: r.isStripe, canVoid: r.canVoid, canEdit: r.canEdit,
          }}
          invoiceId={r.invoiceId}
          currency={r.currency}
          targets={(targetsByCurrency.get(r.currency) ?? []).filter((x) => x.id !== r.invoiceId)}
        />
      ),
    },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Payments" description={t("editMoney.payment.pageHint")} />
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
              Total collected: {totals.map((x) => <span key={x.currency} className="tnum ml-1 text-ink">{f.money(x.amount, x.currency)}</span>)}
            </span>
          )}
        </CardBody>
      </Card>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={<EmptyState icon={<CreditCard className="h-5 w-5" />} title="No payments yet" />} />
    </div>
  );
}

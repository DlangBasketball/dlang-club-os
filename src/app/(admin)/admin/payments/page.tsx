import Link from "next/link";
import { CreditCard } from "lucide-react";
import { PageHeader, DataTable, EmptyState, ErrorState, Badge, statusTone, Card, CardBody, type Column } from "@/components/ui";
import { listPayments, collectedTotals, PAYMENT_FILTERS, type PaymentFilter, type PaymentRow } from "@/lib/data/payments-admin";
import { Pager, pageParam } from "@/components/ui/pager";
import { listReallocationTargets, type ReallocationTarget } from "@/lib/data/money-edit";
import { getFormatter, getTranslations } from "@/lib/i18n/server";
import { METHOD_INFO, isKnownMethod } from "@/lib/payments/methods";
import { PaymentBadges, PaymentRowActions } from "@/components/money/money-panels";
import { Button } from "@/components/ui";
import { listReceipts } from "@/lib/data/player-billing";
import { ReceiptsSection } from "@/components/player-billing/receipts-section";

/** Payments / Receipts switch (?view=receipts); the payments list itself is unchanged. */
async function ViewTabs({ view }: { view: "payments" | "receipts" }) {
  const t = await getTranslations();
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <nav aria-label={t("playerBilling.receipts.viewsLabel")} className="flex gap-2">
        {(["payments", "receipts"] as const).map((v) => (
          <Link key={v} href={v === "payments" ? "/admin/payments" : "/admin/payments?view=receipts"} aria-current={view === v ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${view === v ? "bg-maroon-soft text-maroon" : "bg-surface-elevated text-ink-3 hover:text-ink"}`}>
            {v === "payments" ? t("editMoney.paymentList.title") : t("playerBilling.receipts.title")}
          </Link>
        ))}
      </nav>
      <Link href="/admin/payments/record"><Button size="sm">{t("playerBilling.record.title")}</Button></Link>
    </div>
  );
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string; view?: string }> }) {
  const [f, t] = await Promise.all([getFormatter(), getTranslations()]);
  const { status, page: rawPage, view } = await searchParams;
  if (view === "receipts") {
    const [open, recent] = await Promise.all([listReceipts({ onlyOpen: true, limit: 200 }), listReceipts({ limit: 50 })]);
    return (
      <div className="animate-fade-up">
        <PageHeader title={t("playerBilling.receipts.title")} description={t("playerBilling.receipts.description")} />
        <ViewTabs view="receipts" />
        <ReceiptsSection open={open.data ?? []} recent={recent.data ?? []} error={open.error ?? recent.error} />
      </div>
    );
  }
  const page = pageParam(rawPage);
  const filter: PaymentFilter = (PAYMENT_FILTERS as readonly string[]).includes(status ?? "") ? (status as PaymentFilter) : "all";
  const [list, collected] = await Promise.all([listPayments(filter, page), collectedTotals()]);
  const error = list.error ?? collected.error;
  if (error) return (<div className="animate-fade-up"><PageHeader title={t("editMoney.paymentList.title")} /><ErrorState title={t("editMoney.paymentList.loadError")} message={error} /></div>);
  const rows = list.data!;
  const totals = collected.data!;

  // Open invoices per currency, for re-allocating manual payments.
  const currencies = Array.from(new Set(rows.filter((r) => r.canEdit).map((r) => r.currency)));
  const targetsByCurrency = new Map<string, ReallocationTarget[]>(
    await Promise.all(currencies.map(async (c) => [c, await listReallocationTargets(c)] as const)),
  );

  const columns: Column<PaymentRow>[] = [
    { key: "invoiceNumber", header: t("editMoney.paymentList.colInvoice"), render: (r) => <Link href={`/admin/invoices/${r.invoiceId}`} className="tnum font-medium text-ink hover:text-maroon">{r.invoiceNumber}</Link> },
    {
      key: "method",
      header: t("editMoney.paymentList.colMethod"),
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          {isKnownMethod(r.method) ? METHOD_INFO[r.method].label : r.method}
          <PaymentBadges voided={Boolean(r.voidedAt)} isReversal={r.isReversal} methodDetail={r.methodDetail} isStripe={r.isStripe} />
        </span>
      ),
    },
    { key: "at", header: t("editMoney.paymentList.colDate"), render: (r) => f.date(r.at) },
    { key: "status", header: t("editMoney.paymentList.colStatus"), render: (r) => <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status.replace("_", " "))}</Badge> },
    {
      key: "amount",
      header: t("editMoney.paymentList.colAmount"),
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
      <PageHeader title={t("editMoney.paymentList.title")} description={t("editMoney.payment.pageHint")} />
      <ViewTabs view="payments" />
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-2 py-3">
          {PAYMENT_FILTERS.map((k) => (
            <Link key={k} href={`/admin/payments?status=${k}`}
              className={`rounded-full px-3 py-1 text-xs ${filter === k ? "bg-maroon-soft text-maroon" : "bg-surface-elevated text-ink-3 hover:text-ink"}`}>
              {t(`editMoney.paymentList.filters.${k}`)}
            </Link>
          ))}
          {totals.length > 0 && (
            <span className="ml-auto text-xs text-ink-3">
              {t("editMoney.paymentList.totalCollected")} {totals.map((x) => <span key={x.currency} className="tnum ml-1 text-ink">{f.money(x.amount, x.currency)}</span>)}
            </span>
          )}
        </CardBody>
      </Card>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={<EmptyState icon={<CreditCard className="h-5 w-5" />} title={t("editMoney.paymentList.empty")} />} />
      <Pager basePath="/admin/payments" params={{ status: filter === "all" ? undefined : filter }} page={page} hasMore={Boolean(list.hasMore)} />
    </div>
  );
}

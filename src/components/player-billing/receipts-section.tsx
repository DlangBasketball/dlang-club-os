import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, statusTone } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import type { ReceiptView } from "@/lib/data/player-billing";
import { CategoryPill } from "./category-pill";

/**
 * Payments page, "Receipts" view: unallocated receipts (Finance worklist,
 * with "Allocate") and the latest receipts with their allocations.
 */
export async function ReceiptsSection({ open, recent, error }: { open: ReceiptView[]; recent: ReceiptView[]; error?: string | null }) {
  const { t, f } = await getI18n();
  if (error) return <p role="alert" className="text-sm text-danger">{t("playerBilling.errors.loadFailed")}</p>;
  const row = (r: ReceiptView, allocate: boolean) => (
    <li key={r.id} className="space-y-1 border-b border-border-soft px-5 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm">
          <Link href={`/admin/payments/receipts/${r.id}`} className="font-medium text-text hover:text-brand-primary">{f.money(r.amount, r.currency)} · {f.date(r.receivedOn)}</Link>
          <span className="ml-2 text-xs text-text-muted">
            {[r.payerName, r.familyName, t.dynamic(`roster.payments.methods.${r.method}`, undefined, r.method), r.reference].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {r.unallocated > 0 && <span className="tnum text-xs text-warning">{t("playerBilling.receipts.leftToAllocate", { amount: f.money(r.unallocated, r.currency) })}</span>}
          <Badge tone={statusTone(r.status)}>{t.dynamic(`playerBilling.receiptStatus.${r.status}`, undefined, r.status)}</Badge>
          {allocate && <Link href={`/admin/payments/receipts/${r.id}`} className="text-xs font-medium text-brand-primary hover:underline">{t("playerBilling.receipts.allocate")}</Link>}
        </span>
      </div>
      {r.allocations.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {r.allocations.map((a) => (
            <li key={a.paymentId} className={`inline-flex items-center gap-1 ${a.voided ? "line-through opacity-60" : ""}`}>
              <Link href={`/admin/invoices/${a.invoiceId}`} className="tnum text-brand-primary hover:underline">{a.invoiceNumber}</Link>
              <CategoryPill category={a.category} />
              <span className="tnum text-text-secondary">{f.money(a.amount, r.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>{t("playerBilling.receipts.unallocatedTitle")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {open.length === 0 ? <div className="p-5"><EmptyState title={t("playerBilling.receipts.noneOpen")} /></div> : <ul>{open.map((r) => row(r, true))}</ul>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("playerBilling.receipts.recentTitle")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {recent.length === 0 ? <div className="p-5"><EmptyState title={t("playerBilling.receipts.none")} /></div> : <ul>{recent.map((r) => row(r, false))}</ul>}
        </CardBody>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { Badge, statusTone } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getInvoiceBillingLine } from "@/lib/data/player-billing";
import { CategoryPill, MoneyStatusPill } from "./category-pill";

/**
 * Who pays, who issues, and the invoice number + category of one invoice —
 * shown on the selection enrolment money panel and the booking page. Renders
 * nothing when the caller cannot see the invoice (RLS).
 */
export async function InvoiceBillingLine({ invoiceId, showPaymentStatus = false }: { invoiceId: string | null | undefined; showPaymentStatus?: boolean }) {
  const [{ t, f }, line] = await Promise.all([getI18n(), getInvoiceBillingLine(invoiceId)]);
  if (!line) return null;
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("playerBilling.line.invoice")}</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          <Link href={`/admin/invoices/${line.id}`} className="tnum font-medium text-brand-primary hover:underline">{line.number}</Link>
          <CategoryPill category={line.category} label={line.categoryLabel} />
          <Badge tone={statusTone(line.status)}>{t.dynamic(`status.${line.status}`, undefined, line.status)}</Badge>
        </dd>
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("playerBilling.line.payer")}</dt>
        <dd className="text-text">
          {line.payerName ?? line.familyName ?? "—"}
          {line.payerKind && <span className="ml-1 text-xs text-text-muted">({t.dynamic(`playerBilling.payerKinds.${line.payerKind}`, undefined, line.payerKind)})</span>}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("playerBilling.line.entity")}</dt>
        <dd className="text-text">{line.entityName ?? "—"}</dd>
      </div>
      {showPaymentStatus && (
        <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
          <MoneyStatusPill status={line.paymentStatus} />
          <span className="tnum text-xs text-text-muted">{t("playerBilling.common.balanceShort", { amount: f.money(line.balance, line.currency) })}</span>
        </div>
      )}
    </dl>
  );
}

import { Badge, type BadgeProps } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import type { InstalmentStatus } from "@/lib/payments/plans";
import type { PlanView } from "@/lib/plans/data";
import { PayInstalmentButton, PayPlanBalanceButton, QrBillLink } from "./plan-widgets";

export function instalmentTone(s: InstalmentStatus | string): BadgeProps["tone"] {
  if (s === "paid") return "success";
  if (s === "overdue") return "danger";
  if (s === "due") return "warning";
  if (s === "upcoming") return "info";
  return "neutral";
}

/**
 * Instalments of one plan: due date, amount, status, and per open instalment
 * the online payment (Stripe Checkout, card / TWINT) and its own QR-bill.
 */
export async function InstalmentTable({ plan, pdfBase, canPayOnline, showQr, highlight }: {
  plan: PlanView; pdfBase: string | null; canPayOnline: boolean; showQr: boolean; highlight?: string | null;
}) {
  const { t, f } = await getI18n();
  const money = (n: number) => f.money(n, plan.currency);
  const openCount = plan.instalments.filter((i) => i.outstanding > 0 && i.status !== "cancelled" && i.status !== "skipped").length;
  const showPayAll = plan.kind === "installments" && plan.outstanding > 0 && openCount > 1;
  return (
    <div className="space-y-3">
    <div className="overflow-x-auto" role="region" aria-label={t("plans.common.schedule")} tabIndex={0}>
      <table className="w-full text-sm">
        <caption className="sr-only">{t("plans.common.schedule")}</caption>
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.12em] text-ink-3">
            <th scope="col" className="py-2 pr-3 font-medium">{t("plans.common.instalment")}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{t("plans.common.dueDate")}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{t("plans.common.amount")}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{t("plans.common.status")}</th>
            <th scope="col" className="py-2 font-medium"><span className="sr-only">{t("common.actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {plan.instalments.map((i) => {
            const open = i.outstanding > 0 && i.status !== "cancelled" && i.status !== "skipped";
            return (
              <tr key={i.id} className={`border-b border-line/60 ${highlight === i.id ? "bg-maroon-soft" : ""}`}>
                <td className="py-2 pr-3 text-ink-2">
                  {plan.kind === "installments" ? t("plans.common.seqOf", { seq: i.seq, count: plan.count }) : i.periodStart ? f.dateRange(i.periodStart, i.periodEnd ?? i.periodStart) : "—"}
                </td>
                <td className="py-2 pr-3 tnum">{f.date(i.dueDate)}</td>
                <td className="py-2 pr-3 text-right tnum">
                  {money(i.amount)}
                  {i.amountPaid > 0 && i.outstanding > 0 && <div className="text-xs text-ink-3">{t("plans.common.paidSoFar", { amount: money(i.amountPaid) })}</div>}
                </td>
                <td className="py-2 pr-3">
                  <Badge tone={instalmentTone(i.status)}>{t.dynamic(`plans.status.${i.status}`, undefined, i.status)}</Badge>
                  {i.autopayStatus && i.autopayStatus !== "succeeded" && open && (
                    <div className="mt-1 text-xs text-ink-3">{t.dynamic(`plans.autopay.status.${i.autopayStatus}`, { date: i.autopayNextOn ? f.date(i.autopayNextOn) : "" }, i.autopayStatus)}</div>
                  )}
                </td>
                <td className="py-2">
                  {open && (plan.kind === "installments" || i.invoiceId) && (
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {showQr && pdfBase && plan.kind === "installments" && <QrBillLink href={`${pdfBase}?installment=${i.id}`} label={t("plans.common.qrBill")} />}
                      {canPayOnline && <PayInstalmentButton installmentId={i.id} label={t("plans.common.payNow", { amount: money(Math.min(i.outstanding, plan.outstanding)) })} />}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {showPayAll && (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-3">
        <p className="text-sm text-ink-2">{t("plans.common.payAllHint", { amount: money(plan.outstanding), count: openCount })}</p>
        <div className="flex flex-wrap items-center gap-3">
          {showQr && pdfBase && <QrBillLink href={pdfBase} label={t("plans.common.qrBillFull")} />}
          {canPayOnline && <PayPlanBalanceButton planId={plan.id} label={t("plans.common.payAll", { amount: money(plan.outstanding) })} />}
        </div>
      </div>
    )}
    </div>
  );
}

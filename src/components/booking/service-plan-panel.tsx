import Link from "next/link";
import { CalendarClock, Receipt } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { InstalmentTable } from "@/components/plans/instalment-table";
import { getI18n } from "@/lib/i18n/server";
import { getInvoicePlan, type PlanView } from "@/lib/plans/data";

export type ServicePlanInvoice = { id: string; number: string | null; payerName?: string | null };

/**
 * Instalments of a service booking (docs/service-instalments.md): per payer
 * invoice the total, each payment with its due date and status, paid and
 * outstanding. Read-only here; payments, QR-bills and schedule edits stay on
 * the invoice page (`invoiceHref`) and in Finance -> Payment plans. Before the
 * invoice is issued, the chosen number of payments is shown.
 */
export async function ServicePlanPanel({ orgId, invoices, chosen, invoiceHref }: {
  orgId: string; invoices: ServicePlanInvoice[]; chosen: number; invoiceHref: (id: string) => string;
}) {
  const { t, f } = await getI18n();
  const plans = (await Promise.all(invoices.map(async (inv) => ({ inv, plan: await getInvoicePlan(inv.id, orgId) }))))
    .filter((x): x is { inv: ServicePlanInvoice; plan: PlanView } => x.plan !== null);
  if (!plans.length && chosen <= 1) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("serviceInstalments.panel.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-4">
        {plans.length === 0 && (
          <p className="flex items-start gap-2 text-sm text-ink-2">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            {t("serviceInstalments.panel.pending", { count: chosen })}
          </p>
        )}
        {plans.map(({ inv, plan }) => {
          const money = (n: number) => f.money(n, plan.currency);
          return (
            <section key={plan.id} className="space-y-2" aria-label={t("serviceInstalments.panel.forInvoice", { number: inv.number ?? "—" })}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-ink">
                  {inv.payerName ? `${inv.payerName} · ` : ""}
                  <Link href={invoiceHref(inv.id)} className="inline-flex items-center gap-1 text-maroon hover:underline">
                    <Receipt className="h-3.5 w-3.5" aria-hidden />{inv.number ?? "—"}
                  </Link>
                </span>
                <span className="text-ink-3">{t("serviceInstalments.panel.payments", { count: plan.count })}</span>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-ink-3">{t("serviceInstalments.panel.total")}</dt><dd className="tnum text-ink">{money(plan.total)}</dd></div>
                <div><dt className="text-xs text-ink-3">{t("plans.common.paid")}</dt><dd className="tnum text-ink">{money(plan.paid)}</dd></div>
                <div><dt className="text-xs text-ink-3">{t("plans.common.outstanding")}</dt><dd className="tnum text-ink">{money(plan.outstanding)}</dd></div>
              </dl>
              <InstalmentTable plan={plan} pdfBase={null} canPayOnline={false} showQr={false} />
            </section>
          );
        })}
      </CardBody>
    </Card>
  );
}

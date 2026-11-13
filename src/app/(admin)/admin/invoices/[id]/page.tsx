import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt, Users, History } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState, StatCard } from "@/components/ui";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { getFamilyCreditBalance, listReallocationTargets } from "@/lib/data/money-edit";
import { InvoiceActions } from "@/components/invoice/invoice-actions";
import { ManualPaymentForm } from "@/components/invoice/manual-payment-form";
import { PaymentMethods } from "@/components/invoice/payment-methods";
import { InvoiceMoneyActions } from "@/components/money/invoice-money-actions";
import { AdjustmentList, FamilyCreditPanel, OverpaymentPanel, PaymentBadges, PaymentRowActions } from "@/components/money/money-panels";
import { FamilyCreditAdjust } from "@/components/money/credit-editors";
import { getPaymentSettings, getAcceptedMethods } from "@/lib/data/payment-settings";
import { formatQrReference, resolveQrBillAccount } from "@/lib/swiss-payments";
import { timeAgo } from "@/lib/utils";
import { getFormatter, getTranslations } from "@/lib/i18n/server";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [f, t] = await Promise.all([getFormatter(), getTranslations()]);
  const { id } = await params;
  const { data, error } = await getInvoiceDetail(id);
  if (error) return <ErrorState title="Couldn't load invoice" message={error} />;
  if (!data) notFound();

  const cur = data.currency;
  const money = (n: number) => f.money(n, cur);
  const [settings, methods, credit, targets] = await Promise.all([
    getPaymentSettings(data.orgId),
    getAcceptedMethods(data.orgId),
    getFamilyCreditBalance(data.family.id, cur),
    listReallocationTargets(cur, data.id),
  ]);
  // Account matching the invoice's own reference (QRR -> QR-IBAN, RF/none -> IBAN).
  const qrAccount = resolveQrBillAccount(settings, data.reference);
  const payIban = qrAccount?.iban ?? settings.iban;
  const statusLabel = t.dynamic(`status.${data.status}`, undefined, t.dynamic(`editMoney.status.${data.status}`, undefined, data.status.replace("_", " ")));
  const outstanding = Math.max(0, data.balance);
  const closed = ["cancelled", "void", "written_off"].includes(data.status);
  const hasAdjustments = data.adjustments.length > 0;
  const activeAdjustments = data.adjustments.filter((a) => !a.voidedAt);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={<span className="tnum">{data.number}</span>}
        description={data.description ?? (data.programName ? `Program: ${data.programName}` : "Invoice")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data.remindersPaused && <Badge tone="neutral">{t("editMoney.invoice.remindersPausedBadge")}</Badge>}
            <Badge tone={data.status === "written_off" ? "neutral" : statusTone(data.status)}>{statusLabel}</Badge>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <InvoiceActions id={data.id} status={data.status} remindersPaused={data.remindersPaused} />
        <InvoiceMoneyActions
          id={data.id}
          number={data.number}
          status={data.status}
          currency={cur}
          total={data.total}
          adjustmentsTotal={data.adjustmentsTotal}
          paid={data.paid}
          remindersPaused={data.remindersPaused}
        />
      </div>

      <OverpaymentPanel invoiceId={data.id} overpaid={data.overpaid} currency={cur} familyName={data.family.name} />

      <div className={`grid grid-cols-1 gap-4 ${hasAdjustments ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <StatCard label={t("editMoney.invoice.originalTotal")} value={money(data.total)} />
        {hasAdjustments && <StatCard label={t("editMoney.invoice.amountDue")} value={money(data.amountDue)} />}
        <StatCard label={t("editMoney.invoice.paid")} value={money(data.paid)} />
        <StatCard label={t("editMoney.invoice.balance")} value={money(outstanding)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Line items (+ active adjustments) */}
          <Card>
            <CardHeader><CardTitle>{t("editMoney.invoice.lines")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-2 font-medium">{t("editMoney.invoice.lineDescription")}</th>
                  <th className="px-5 py-2 text-right font-medium">{t("editMoney.invoice.quantity")}</th>
                  <th className="px-5 py-2 text-right font-medium">{t("editMoney.invoice.unit")}</th>
                  <th className="px-5 py-2 text-right font-medium">{t("editMoney.common.amount")}</th>
                </tr></thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id} className="border-b border-line-soft last:border-0">
                      <td className="px-5 py-2.5 text-ink">{it.description}</td>
                      <td className="px-5 py-2.5 text-right tnum text-ink-2">{f.number(it.quantity)}</td>
                      <td className="px-5 py-2.5 text-right tnum text-ink-2">{money(it.unitPrice)}</td>
                      <td className="px-5 py-2.5 text-right tnum text-ink">{money(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3} className="px-5 py-3 text-right text-ink-2">{t("editMoney.invoice.originalTotal")}</td><td className="px-5 py-3 text-right tnum font-semibold text-ink">{money(data.total)}</td></tr>
                  {activeAdjustments.map((a) => (
                    <tr key={a.id}>
                      <td colSpan={3} className="px-5 py-1.5 text-right text-ink-2">{t.dynamic(`editMoney.adjust.kinds.${a.kind}`, undefined, a.kind)} <span className="tnum">{a.number}</span></td>
                      <td className="px-5 py-1.5 text-right tnum text-ink">{a.kind === "debit_note" ? "+" : "−"} {money(a.amount)}</td>
                    </tr>
                  ))}
                  {activeAdjustments.length > 0 && (
                    <tr><td colSpan={3} className="px-5 py-3 text-right text-ink-2">{t("editMoney.invoice.amountDue")}</td><td className="px-5 py-3 text-right tnum font-semibold text-ink">{money(data.amountDue)}</td></tr>
                  )}
                </tfoot>
              </table>
            </CardBody>
          </Card>

          {/* Credit / debit notes */}
          {hasAdjustments && (
            <Card>
              <CardHeader><CardTitle>{t("editMoney.adjust.listTitle")}</CardTitle></CardHeader>
              <CardBody className="p-0"><AdjustmentList adjustments={data.adjustments} currency={cur} /></CardBody>
            </Card>
          )}

          {/* Payments */}
          <Card>
            <CardHeader><CardTitle>{t("editMoney.payment.listTitle")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {data.payments.length === 0 ? (
                <div className="p-5"><EmptyState icon={<Receipt className="h-5 w-5" />} title={t("editMoney.payment.empty")} /></div>
              ) : (
                <ul>
                  {data.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                      <div className={p.voidedAt ? "opacity-60" : undefined}>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                          {t.dynamic(`editMoney.methods.${p.method}`, undefined, t.dynamic(`payments.methods.${p.method}`, undefined, p.method))}
                          {p.reference ? <span className="tnum text-ink-3">· {p.reference}</span> : null}
                          <PaymentBadges voided={Boolean(p.voidedAt)} isReversal={Boolean(p.reversesPaymentId)} methodDetail={p.methodDetail} isStripe={p.isStripe} />
                        </div>
                        <div className="text-xs text-ink-3">
                          {f.date(p.paidAt)}{p.notes ? ` · ${p.notes}` : ""}
                          {p.voidedAt && p.voidReason ? ` · ${t("editMoney.common.voidedBecause", { reason: p.voidReason })}` : ""}
                        </div>
                        {p.adminNote && <div className="text-xs text-ink-2">{t("editMoney.payment.noteLine", { note: p.adminNote })}</div>}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={`tnum text-sm ${p.amount < 0 ? "text-danger" : "text-success"} ${p.voidedAt ? "line-through" : ""}`}>
                          {p.amount < 0 ? "−" : "+"} {money(Math.abs(p.amount))}
                        </span>
                        <Badge tone={statusTone(p.status)}>{t.dynamic(`status.${p.status}`, undefined, p.status)}</Badge>
                        <PaymentRowActions payment={p} invoiceId={data.id} currency={cur} targets={targets} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Audit trail */}
          <Card>
            <CardHeader><CardTitle>{t("editMoney.invoice.auditTitle")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {data.audit.length === 0 ? (
                <div className="p-5"><EmptyState icon={<History className="h-5 w-5" />} title={t("editMoney.invoice.auditEmpty")} /></div>
              ) : (
                <ul className="text-sm">
                  {data.audit.map((a) => (
                    <li key={`${a.table}-${a.id}`} className="flex items-center justify-between border-b border-line-soft px-5 py-2.5 last:border-0">
                      <span className="text-ink-2">{t.dynamic(`editMoney.audit.${a.action}`, undefined, a.action.replace(/_/g, " "))} <span className="text-ink-4">· {a.table}</span></span>
                      <span className="text-xs text-ink-3">{timeAgo(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t("editMoney.invoice.family")}</CardTitle><Link href={`/admin/families/${data.family.id}`} className="text-xs text-maroon hover:underline">{t("editMoney.common.open")}</Link></CardHeader>
            <CardBody className="space-y-1 text-sm">
              <div className="flex items-center gap-2 font-medium text-ink"><Users className="h-4 w-4" />{data.family.name}</div>
              {data.family.contactName && <div className="text-ink-2">{data.family.contactName}</div>}
              {data.family.contactEmail && <div className="text-ink-3">{data.family.contactEmail}</div>}
              <div className="pt-2 text-ink-3">{t("editMoney.invoice.issuedOn", { date: f.date(data.issuedAt) })}</div>
              <div className="text-ink-3">{t("editMoney.invoice.dueOn", { date: f.date(data.dueDate) })}</div>
              {data.locale && <div className="text-ink-3">{t("editMoney.invoice.languageLine", { language: t.dynamic(`editMoney.languages.${data.locale}`, undefined, data.locale) })}</div>}
              {data.notes && <div className="pt-2 text-ink-2">{data.notes}</div>}
              {data.cancelReason && <div className="pt-2 text-ink-3">{t("editMoney.invoice.cancelledBecause", { reason: data.cancelReason })}</div>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("editMoney.credit.title")}</CardTitle></CardHeader>
            <CardBody>
              <FamilyCreditPanel
                invoiceId={data.id}
                number={data.number}
                credit={credit}
                outstanding={outstanding}
                currency={cur}
                payable={!closed && data.status !== "draft"}
              />
              <div className="mt-2">
                <FamilyCreditAdjust familyId={data.family.id} familyName={data.family.name} currency={cur} balance={credit} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Swiss payment details</CardTitle></CardHeader>
            <CardBody className="space-y-3 text-sm">
              {data.reference && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink-3">QR reference</div>
                  <div className="tnum text-ink">{formatQrReference(data.reference)}</div>
                </div>
              )}
              {payIban && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink-3">{qrAccount?.referenceType === "QRR" ? "QR-IBAN" : "IBAN"}</div>
                  <div className="tnum text-ink">{payIban}</div>
                </div>
              )}
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-ink-3">Accepted methods</div>
                <PaymentMethods methods={methods} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("editMoney.payment.record")}</CardTitle></CardHeader>
            <CardBody>
              {data.status === "cancelled" || data.status === "void" ? (
                <p className="text-sm text-ink-3">{t("editMoney.payment.cancelledNote")}</p>
              ) : (
                <>
                  {outstanding <= 0 && <p className="mb-3 text-sm text-ink-3">{t("editMoney.payment.settledNote")}</p>}
                  <ManualPaymentForm invoiceId={data.id} balance={outstanding} currency={cur} />
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

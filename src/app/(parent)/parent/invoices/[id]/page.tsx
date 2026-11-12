import { notFound } from "next/navigation";
import { CheckCircle2, Landmark, Smartphone, QrCode, Copy, FileDown } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, ErrorState } from "@/components/ui";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { getPaymentSettings, getAcceptedMethods } from "@/lib/data/payment-settings";
import { formatQrReference } from "@/lib/swiss-payments";
import { PaymentMethods } from "@/components/invoice/payment-methods";
import { PayButton } from "../pay-button";
import { getI18n } from "@/lib/i18n/server";

export default async function ParentInvoiceDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid } = await searchParams;
  const [{ data, error }, { t, f }] = await Promise.all([getInvoiceDetail(id), getI18n()]); // RLS: parent only sees their own
  if (error) return <ErrorState title={t("invoices.loadOneError")} message={error} />;
  if (!data) notFound();

  const [settings, methods] = await Promise.all([getPaymentSettings(data.orgId), getAcceptedMethods(data.orgId)]);
  const payable = data.balance > 0 && data.status !== "cancelled" && data.status !== "paid";
  const reference = data.reference ? formatQrReference(data.reference) : null;
  const payIban = settings.referenceType === "QRR" ? settings.qrIban : settings.iban;
  const allowsCard = methods.some((m) => m.key === "card");
  const allowsTwint = methods.some((m) => m.key === "twint");
  const allowsBank = methods.some((m) => m.key === "bank_transfer");

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={<span className="tnum">{data.number}</span>} description={data.description ?? t("invoices.invoice")}
        actions={<Badge tone={statusTone(data.status)}>{t.dynamic(`status.${data.status}`, undefined, data.status.replace("_", " "))}</Badge>} />

      {paid === "1" && (
        <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> {t("invoices.thankYouProcessing")}
        </div>
      )}

      <Card>
        <CardBody className="space-y-3">
          {data.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between text-sm">
              <span className="text-ink-2">{it.description}{it.quantity > 1 ? ` × ${it.quantity}` : ""}</span>
              <span className="tnum text-ink">{f.money(it.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-3 text-sm"><span className="text-ink-2">{t("invoices.total")}</span><span className="tnum text-ink">{f.money(data.total)}</span></div>
          {data.paid > 0 && <div className="flex items-center justify-between text-sm"><span className="text-ink-2">{t("invoices.paid")}</span><span className="tnum text-success">- {f.money(data.paid)}</span></div>}
          <div className="flex items-center justify-between border-t border-line pt-3 text-base font-semibold"><span>{t("invoices.balanceDue")}</span><span className="tnum text-maroon">{f.money(data.balance)}</span></div>
          <div className="text-xs text-ink-3">{t("invoices.due", { date: f.date(data.dueDate) })}</div>
          <div className="pt-2"><PaymentMethods methods={methods} /></div>
        </CardBody>
      </Card>

      {payable && (
        <>
          {/* Stripe — the automated first option */}
          {allowsCard && (
            <Card>
              <CardHeader><CardTitle>{t("payments.payOnline")}</CardTitle></CardHeader>
              <CardBody className="space-y-2">
                <PayButton invoiceId={data.id} />
                <p className="text-xs text-ink-3">{t("payments.cardHint")}</p>
              </CardBody>
            </Card>
          )}

          {/* Manual Swiss methods */}
          <Card>
            <CardHeader><CardTitle>{allowsTwint ? t("payments.manualTitle") : t("payments.bankTitle")}</CardTitle></CardHeader>
            <CardBody className="space-y-4 text-sm text-ink-2">
              {reference && (
                <div className="rounded-md border border-maroon/30 bg-maroon-soft px-4 py-3">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-maroon"><QrCode className="h-3.5 w-3.5" /> {t("payments.reference")}</div>
                  <div className="tnum mt-1 text-base text-ink">{reference}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-ink-3"><Copy className="h-3 w-3" /> {t("payments.referenceHint")}</div>
                </div>
              )}
              {allowsTwint && settings.twintNumber && (
                <div className="flex items-start gap-2"><Smartphone className="mt-0.5 h-4 w-4 text-ink-3" />
                  <span>{t("payments.twintTo", { number: settings.twintNumber, reference: reference ?? data.number })}</span>
                </div>
              )}
              {allowsBank && payIban && (
                <div className="flex items-start gap-2"><Landmark className="mt-0.5 h-4 w-4 text-ink-3" />
                  <span className="tnum">{t("payments.bankTo", { creditor: settings.creditorName, iban: payIban, reference: reference ?? data.number })}</span>
                </div>
              )}
              <div className="border-t border-line pt-3">
                <a href={`/parent/invoices/${data.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-maroon hover:underline">
                  <FileDown className="h-4 w-4" /> {t("invoices.downloadQrBill")}
                </a>
              </div>
              <p className="text-xs text-ink-3">{t("payments.reconciledHint")}</p>
            </CardBody>
          </Card>
        </>
      )}

      {data.status === "paid" && (
        <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> {t("invoices.fullyPaid")}
        </div>
      )}
    </div>
  );
}

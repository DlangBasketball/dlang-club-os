import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CheckCircle2, Landmark, Smartphone, QrCode, Copy, FileDown } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, ErrorState } from "@/components/ui";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { buildEpcQrPayload } from "@/lib/payments/epc-qr";
import { formatQrReference, resolveQrBillAccount } from "@/lib/swiss-payments";
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

  const profile = await getOrgPaymentProfile(data.orgId);
  const methods = methodsForInvoice(profile, data.currency);
  const money = (n: number) => f.money(n, data.currency);
  const settings = profile.swiss;
  const payable = data.balance > 0 && !["cancelled", "void", "paid", "written_off"].includes(data.status);
  const activeAdjustments = data.adjustments.filter((a) => !a.voidedAt);

  const isSwiss = profile.region === "CH";
  // Swiss clubs: pair the invoice's own reference with the account kind it
  // needs (QRR -> QR-IBAN, RF/none -> normal IBAN). Without a matching account
  // the structured reference is dropped and the invoice number is used instead.
  const swissAccount = isSwiss ? resolveQrBillAccount(settings, data.reference) : null;
  const reference = isSwiss
    ? swissAccount?.reference
      ? swissAccount.referenceType === "QRR" ? formatQrReference(swissAccount.reference) : swissAccount.reference
      : null
    : data.reference ?? null;
  const payIban = isSwiss
    ? swissAccount?.iban ?? (settings.iban || profile.settings.iban || "")
    : profile.settings.iban || settings.iban;

  const online = methods.filter((m) => m.via === "stripe");
  const offline = methods.filter((m) => m.via === "offline" && m.key !== "manual");
  const twint = offline.find((m) => m.key === "twint");
  const bank = offline.find((m) => m.key === "bank_transfer" || m.key === "qr_bill");
  const delayed = online.some((m) => m.delayedSettlement);

  // Optional EPC ("GiroCode") QR for SEPA credit transfers (EUR, EU clubs).
  let epcQr: string | null = null;
  if (payable && profile.region === "EU" && profile.settings.epc_qr_enabled && data.currency === "EUR" && payIban) {
    try {
      epcQr = await QRCode.toDataURL(
        buildEpcQrPayload({
          name: profile.settings.creditor?.name ?? profile.name,
          iban: payIban,
          bic: profile.settings.bic,
          amountEur: data.balance,
          reference: data.reference?.startsWith("RF") ? data.reference : null,
          text: data.reference?.startsWith("RF") ? null : data.number,
        }),
        { errorCorrectionLevel: "M", margin: 1, width: 200 },
      );
    } catch {
      epcQr = null;
    }
  }

  let methodList = online.map((m) => m.label).join(", ");
  try {
    methodList = new Intl.ListFormat(f.locale, { type: "disjunction" }).format(online.map((m) => m.label));
  } catch {
    /* older runtimes: keep the comma list */
  }
  const onlineLabel = online.length ? t("payments.payWith", { methods: methodList }) : t("payments.payOnline");

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={<span className="tnum">{data.number}</span>} description={data.description ?? t("invoices.invoice")}
        actions={<Badge tone={statusTone(data.status)}>{t.dynamic(`status.${data.status}`, undefined, t.dynamic(`editMoney.status.${data.status}`, undefined, data.status.replace("_", " ")))}</Badge>} />

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
              <span className="tnum text-ink">{money(it.amount)}</span>
            </div>
          ))}
          {(data.tax.amount > 0 || data.tax.reverseCharge) && (
            <div className="flex items-center justify-between border-t border-line pt-3 text-sm text-ink-3">
              <span>
                {data.tax.reverseCharge
                  ? t("payments.reverseCharge")
                  : t(data.tax.inclusive ? "payments.taxLineIncluded" : "payments.taxLine", { label: data.tax.label ?? profile.taxLabel, rate: data.tax.rate })}
              </span>
              <span className="tnum">{money(data.tax.amount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-line pt-3 text-sm"><span className="text-ink-2">{t("invoices.total")}</span><span className="tnum text-ink">{money(data.total)}</span></div>
          {/* Credit / debit notes issued on this invoice (the original total never changes). */}
          {activeAdjustments.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm">
              <span className="text-ink-2">{t.dynamic(`editMoney.adjust.kinds.${a.kind}`, undefined, a.kind)} <span className="tnum">{a.number}</span>{a.description ? ` · ${a.description}` : ""}</span>
              <span className="tnum text-ink">{a.kind === "debit_note" ? "+" : "−"} {money(a.amount)}</span>
            </div>
          ))}
          {data.paid > 0 && <div className="flex items-center justify-between text-sm"><span className="text-ink-2">{t("invoices.paid")}</span><span className="tnum text-success">- {money(data.paid)}</span></div>}
          <div className="flex items-center justify-between border-t border-line pt-3 text-base font-semibold"><span>{t("invoices.balanceDue")}</span><span className="tnum text-maroon">{money(Math.max(0, data.balance))}</span></div>
          {data.overpaid > 0 && <div className="text-xs text-ink-3">{t("editMoney.overpay.parentNote", { amount: money(data.overpaid) })}</div>}
          {data.notes && <div className="text-sm text-ink-2">{data.notes}</div>}
          <div className="text-xs text-ink-3">{t("invoices.due", { date: f.date(data.dueDate) })}</div>
          <div className="pt-2"><PaymentMethods methods={methods} /></div>
        </CardBody>
      </Card>

      {payable && (
        <>
          {online.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t("payments.payOnline")}</CardTitle></CardHeader>
              <CardBody className="space-y-2">
                <PayButton invoiceId={data.id} label={onlineLabel} />
                <p className="text-xs text-ink-3">
                  {t("payments.stripeHint", { club: profile.name })}
                  {delayed && ` ${t("payments.delayedHint")}`}
                </p>
              </CardBody>
            </Card>
          )}

          {offline.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{isSwiss && twint ? t("payments.manualTitle") : t("payments.bankTitle")}</CardTitle></CardHeader>
              <CardBody className="space-y-4 text-sm text-ink-2">
                {reference && (
                  <div className="rounded-md border border-maroon/30 bg-maroon-soft px-4 py-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-maroon"><QrCode className="h-3.5 w-3.5" /> {t("payments.reference")}</div>
                    <div className="tnum mt-1 text-base text-ink">{reference}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-ink-3"><Copy className="h-3 w-3" /> {t("payments.referenceHint")}</div>
                  </div>
                )}
                {twint && settings.twintNumber && (
                  <div className="flex items-start gap-2"><Smartphone className="mt-0.5 h-4 w-4 text-ink-3" />
                    <span>{t("payments.twintTo", { number: settings.twintNumber, reference: reference ?? data.number })}</span>
                  </div>
                )}
                {bank && payIban && (
                  <div className="flex items-start gap-2"><Landmark className="mt-0.5 h-4 w-4 text-ink-3" />
                    <span className="tnum">
                      {profile.settings.bic
                        ? t("payments.bankToBic", { creditor: profile.settings.creditor?.name ?? settings.creditorName, iban: payIban, bic: profile.settings.bic, reference: reference ?? data.number })
                        : t("payments.bankTo", { creditor: profile.settings.creditor?.name ?? settings.creditorName, iban: payIban, reference: reference ?? data.number })}
                    </span>
                  </div>
                )}
                {epcQr && (
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={epcQr} alt={t("payments.epcAlt")} width={120} height={120} className="rounded bg-white p-1" />
                    <span className="text-xs text-ink-3">{t("payments.epcHint")}</span>
                  </div>
                )}
                {isSwiss && (
                  <div className="border-t border-line pt-3">
                    <a href={`/parent/invoices/${data.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-maroon hover:underline">
                      <FileDown className="h-4 w-4" /> {t("invoices.downloadQrBill")}
                    </a>
                  </div>
                )}
                <p className="text-xs text-ink-3">{isSwiss && twint ? t("payments.reconciledHint") : t("payments.reconciledBankHint")}</p>
              </CardBody>
            </Card>
          )}
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

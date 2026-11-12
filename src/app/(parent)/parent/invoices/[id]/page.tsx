import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CheckCircle2, Landmark, Smartphone, QrCode, Copy, FileDown } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, ErrorState } from "@/components/ui";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { formatMoney } from "@/lib/payments/currency";
import { buildEpcQrPayload } from "@/lib/payments/epc-qr";
import { formatQrReference } from "@/lib/swiss-payments";
import { PaymentMethods } from "@/components/invoice/payment-methods";
import { PayButton } from "../pay-button";
import { formatDate } from "@/lib/utils";

export default async function ParentInvoiceDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid } = await searchParams;
  const { data, error } = await getInvoiceDetail(id); // RLS: parent only sees their own
  if (error) return <ErrorState title="Couldn't load invoice" message={error} />;
  if (!data) notFound();

  const profile = await getOrgPaymentProfile(data.orgId);
  const methods = methodsForInvoice(profile, data.currency);
  const money = (n: number) => formatMoney(n, data.currency);
  const settings = profile.swiss;
  const payable = data.balance > 0 && data.status !== "cancelled" && data.status !== "paid";

  const isSwiss = profile.region === "CH";
  const reference = data.reference ? (isSwiss ? formatQrReference(data.reference) : data.reference) : null;
  const payIban = isSwiss && settings.referenceType === "QRR" ? settings.qrIban || settings.iban : profile.settings.iban || settings.iban;

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

  const onlineLabel = online.length
    ? `Pay with ${online.map((m) => m.label).join(", ").replace(/, ([^,]*)$/, " or $1")}`
    : "Pay online";

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={<span className="tnum">{data.number}</span>} description={data.description ?? "Invoice"}
        actions={<Badge tone={statusTone(data.status)}>{data.status.replace("_", " ")}</Badge>} />

      {paid === "1" && (
        <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> Thank you — your payment is being processed and will appear shortly.
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
                  ? "Reverse charge — VAT payable by recipient"
                  : `${data.tax.label ?? profile.taxLabel} ${data.tax.rate}%${data.tax.inclusive ? " (included)" : ""}`}
              </span>
              <span className="tnum">{money(data.tax.amount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-line pt-3 text-sm"><span className="text-ink-2">Total</span><span className="tnum text-ink">{money(data.total)}</span></div>
          {data.paid > 0 && <div className="flex items-center justify-between text-sm"><span className="text-ink-2">Paid</span><span className="tnum text-success">- {money(data.paid)}</span></div>}
          <div className="flex items-center justify-between border-t border-line pt-3 text-base font-semibold"><span>Balance due</span><span className="tnum text-maroon">{money(data.balance)}</span></div>
          <div className="text-xs text-ink-3">Due {formatDate(data.dueDate)}</div>
          <div className="pt-2"><PaymentMethods methods={methods} /></div>
        </CardBody>
      </Card>

      {payable && (
        <>
          {online.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Pay online</CardTitle></CardHeader>
              <CardBody className="space-y-2">
                <PayButton invoiceId={data.id} label={onlineLabel} />
                <p className="text-xs text-ink-3">
                  Secure payment via Stripe, paid directly to {profile.name}. Your invoice updates automatically once paid.
                  {delayed && " Bank debits (SEPA / ACH) confirm within 3–5 business days."}
                </p>
              </CardBody>
            </Card>
          )}

          {offline.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{isSwiss ? "Pay by TWINT or bank transfer" : "Pay by bank transfer"}</CardTitle></CardHeader>
              <CardBody className="space-y-4 text-sm text-ink-2">
                {reference && (
                  <div className="rounded-md border border-maroon/30 bg-maroon-soft px-4 py-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-maroon"><QrCode className="h-3.5 w-3.5" /> Payment reference</div>
                    <div className="tnum mt-1 text-base text-ink">{reference}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-ink-3"><Copy className="h-3 w-3" /> Always include this reference so we can match your payment.</div>
                  </div>
                )}
                {twint && settings.twintNumber && (
                  <div className="flex items-start gap-2"><Smartphone className="mt-0.5 h-4 w-4 text-ink-3" />
                    <span>TWINT to <span className="text-ink">{settings.twintNumber}</span> — include reference <span className="tnum text-ink">{reference ?? data.number}</span>.</span>
                  </div>
                )}
                {bank && payIban && (
                  <div className="flex items-start gap-2"><Landmark className="mt-0.5 h-4 w-4 text-ink-3" />
                    <span>
                      Bank transfer to <span className="text-ink">{profile.settings.creditor?.name ?? settings.creditorName}</span>, IBAN <span className="tnum text-ink">{payIban}</span>
                      {profile.settings.bic ? <> (BIC <span className="tnum text-ink">{profile.settings.bic}</span>)</> : null}
                      {" "}— reference <span className="tnum text-ink">{reference ?? data.number}</span>.
                    </span>
                  </div>
                )}
                {epcQr && (
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={epcQr} alt="SEPA transfer QR code" width={120} height={120} className="rounded bg-white p-1" />
                    <span className="text-xs text-ink-3">Scan with your banking app to pre-fill the SEPA transfer.</span>
                  </div>
                )}
                {isSwiss && (
                  <div className="border-t border-line pt-3">
                    <a href={`/parent/invoices/${data.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-maroon hover:underline">
                      <FileDown className="h-4 w-4" /> Download invoice with Swiss QR-bill
                    </a>
                  </div>
                )}
                <p className="text-xs text-ink-3">Bank{isSwiss ? " and TWINT" : ""} payments are reconciled by the club office once received.</p>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {data.status === "paid" && (
        <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> This invoice is fully paid. Thank you!
        </div>
      )}
    </div>
  );
}

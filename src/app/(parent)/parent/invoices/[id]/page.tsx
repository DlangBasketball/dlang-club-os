import { notFound } from "next/navigation";
import { CheckCircle2, Landmark, Smartphone, QrCode, Copy, FileDown } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, ErrorState } from "@/components/ui";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { getPaymentSettings, getAcceptedMethods } from "@/lib/data/payment-settings";
import { formatQrReference } from "@/lib/swiss-payments";
import { PaymentMethods } from "@/components/invoice/payment-methods";
import { PayButton } from "../pay-button";
import { formatCHF, formatDate } from "@/lib/utils";

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

  const [settings, methods] = await Promise.all([getPaymentSettings(data.orgId), getAcceptedMethods(data.orgId)]);
  const payable = data.balance > 0 && data.status !== "cancelled" && data.status !== "paid";
  const reference = data.reference ? formatQrReference(data.reference) : null;
  const payIban = settings.referenceType === "QRR" ? settings.qrIban : settings.iban;
  const allowsCard = methods.some((m) => m.key === "card");
  const allowsTwint = methods.some((m) => m.key === "twint");
  const allowsBank = methods.some((m) => m.key === "bank_transfer");

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
              <span className="tnum text-ink">{formatCHF(it.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-3 text-sm"><span className="text-ink-2">Total</span><span className="tnum text-ink">{formatCHF(data.total)}</span></div>
          {data.paid > 0 && <div className="flex items-center justify-between text-sm"><span className="text-ink-2">Paid</span><span className="tnum text-success">- {formatCHF(data.paid)}</span></div>}
          <div className="flex items-center justify-between border-t border-line pt-3 text-base font-semibold"><span>Balance due</span><span className="tnum text-maroon">{formatCHF(data.balance)}</span></div>
          <div className="text-xs text-ink-3">Due {formatDate(data.dueDate)}</div>
          <div className="pt-2"><PaymentMethods methods={methods} /></div>
        </CardBody>
      </Card>

      {payable && (
        <>
          {/* Stripe — the automated first option */}
          {allowsCard && (
            <Card>
              <CardHeader><CardTitle>Pay online</CardTitle></CardHeader>
              <CardBody className="space-y-2">
                <PayButton invoiceId={data.id} />
                <p className="text-xs text-ink-3">Secure card payment via Stripe. Your invoice updates automatically once paid.</p>
              </CardBody>
            </Card>
          )}

          {/* Manual Swiss methods */}
          <Card>
            <CardHeader><CardTitle>Pay by TWINT or bank transfer</CardTitle></CardHeader>
            <CardBody className="space-y-4 text-sm text-ink-2">
              {reference && (
                <div className="rounded-md border border-maroon/30 bg-maroon-soft px-4 py-3">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-maroon"><QrCode className="h-3.5 w-3.5" /> Payment reference</div>
                  <div className="tnum mt-1 text-base text-ink">{reference}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-ink-3"><Copy className="h-3 w-3" /> Always include this reference so we can match your payment.</div>
                </div>
              )}
              {allowsTwint && settings.twintNumber && (
                <div className="flex items-start gap-2"><Smartphone className="mt-0.5 h-4 w-4 text-ink-3" />
                  <span>TWINT to <span className="text-ink">{settings.twintNumber}</span> — include reference <span className="tnum text-ink">{reference ?? data.number}</span>.</span>
                </div>
              )}
              {allowsBank && payIban && (
                <div className="flex items-start gap-2"><Landmark className="mt-0.5 h-4 w-4 text-ink-3" />
                  <span>Bank transfer to <span className="text-ink">{settings.creditorName}</span>, IBAN <span className="tnum text-ink">{payIban}</span> — reference <span className="tnum text-ink">{reference ?? data.number}</span>.</span>
                </div>
              )}
              <div className="border-t border-line pt-3">
                <a href={`/parent/invoices/${data.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-maroon hover:underline">
                  <FileDown className="h-4 w-4" /> Download invoice with Swiss QR-bill
                </a>
              </div>
              <p className="text-xs text-ink-3">TWINT and bank payments are reconciled by the club office once received.</p>
            </CardBody>
          </Card>
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

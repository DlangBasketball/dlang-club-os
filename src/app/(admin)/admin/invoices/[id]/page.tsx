import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt, Users, History } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState, StatCard } from "@/components/ui";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { InvoiceActions } from "@/components/invoice/invoice-actions";
import { ManualPaymentForm } from "@/components/invoice/manual-payment-form";
import { PaymentMethods } from "@/components/invoice/payment-methods";
import { getPaymentSettings, getAcceptedMethods } from "@/lib/data/payment-settings";
import { formatQrReference, resolveQrBillAccount } from "@/lib/swiss-payments";
import { formatDate, timeAgo } from "@/lib/utils";
import { getFormatter } from "@/lib/i18n/server";

const METHOD_LABEL: Record<string, string> = { card: "Card", bank_transfer: "Bank transfer", twint: "TWINT", manual: "Cash / manual", qr_bill: "QR-bill" };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const f = await getFormatter();
  const { id } = await params;
  const { data, error } = await getInvoiceDetail(id);
  if (error) return <ErrorState title="Couldn't load invoice" message={error} />;
  if (!data) notFound();

  const [settings, methods] = await Promise.all([getPaymentSettings(data.orgId), getAcceptedMethods(data.orgId)]);
  // Account matching the invoice's own reference (QRR -> QR-IBAN, RF/none -> IBAN).
  const qrAccount = resolveQrBillAccount(settings, data.reference);
  const payIban = qrAccount?.iban ?? settings.iban;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={<span className="tnum">{data.number}</span>}
        description={data.description ?? (data.programName ? `Program: ${data.programName}` : "Invoice")}
        actions={<Badge tone={statusTone(data.status)}>{data.status.replace("_", " ")}</Badge>}
      />

      <InvoiceActions id={data.id} status={data.status} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total" value={f.money(data.total)} />
        <StatCard label="Paid" value={f.money(data.paid)} />
        <StatCard label="Balance" value={f.money(data.balance)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Line items */}
          <Card>
            <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
            <CardBody className="p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-2 font-medium">Description</th>
                  <th className="px-5 py-2 text-right font-medium">Qty</th>
                  <th className="px-5 py-2 text-right font-medium">Unit</th>
                  <th className="px-5 py-2 text-right font-medium">Amount</th>
                </tr></thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id} className="border-b border-line-soft last:border-0">
                      <td className="px-5 py-2.5 text-ink">{it.description}</td>
                      <td className="px-5 py-2.5 text-right tnum text-ink-2">{it.quantity}</td>
                      <td className="px-5 py-2.5 text-right tnum text-ink-2">{f.money(it.unitPrice)}</td>
                      <td className="px-5 py-2.5 text-right tnum text-ink">{f.money(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3} className="px-5 py-3 text-right text-ink-2">Total</td><td className="px-5 py-3 text-right tnum font-semibold text-ink">{f.money(data.total)}</td></tr></tfoot>
              </table>
            </CardBody>
          </Card>

          {/* Payments */}
          <Card>
            <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
            <CardBody className="p-0">
              {data.payments.length === 0 ? (
                <div className="p-5"><EmptyState icon={<Receipt className="h-5 w-5" />} title="No payments yet" /></div>
              ) : (
                <ul>
                  {data.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                      <div>
                        <div className="text-sm text-ink">{METHOD_LABEL[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</div>
                        <div className="text-xs text-ink-3">{formatDate(p.paidAt)}{p.notes ? ` · ${p.notes}` : ""}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="tnum text-sm text-success">+ {f.money(p.amount)}</span>
                        <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Audit trail */}
          <Card>
            <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
            <CardBody className="p-0">
              {data.audit.length === 0 ? (
                <div className="p-5"><EmptyState icon={<History className="h-5 w-5" />} title="No history" /></div>
              ) : (
                <ul className="text-sm">
                  {data.audit.map((a) => (
                    <li key={`${a.table}-${a.id}`} className="flex items-center justify-between border-b border-line-soft px-5 py-2.5 last:border-0">
                      <span className="text-ink-2">{a.action.replace("_", " ")} <span className="text-ink-4">· {a.table}</span></span>
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
            <CardHeader><CardTitle>Family</CardTitle><Link href={`/admin/families/${data.family.id}`} className="text-xs text-maroon hover:underline">Open</Link></CardHeader>
            <CardBody className="space-y-1 text-sm">
              <div className="flex items-center gap-2 font-medium text-ink"><Users className="h-4 w-4" />{data.family.name}</div>
              {data.family.contactName && <div className="text-ink-2">{data.family.contactName}</div>}
              {data.family.contactEmail && <div className="text-ink-3">{data.family.contactEmail}</div>}
              <div className="pt-2 text-ink-3">Issued {formatDate(data.issuedAt)}</div>
              <div className="text-ink-3">Due {formatDate(data.dueDate)}</div>
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
            <CardHeader><CardTitle>Record payment</CardTitle></CardHeader>
            <CardBody>
              {data.status === "paid" ? (
                <p className="text-sm text-ink-3">This invoice is fully paid.</p>
              ) : data.status === "cancelled" ? (
                <p className="text-sm text-ink-3">This invoice was cancelled.</p>
              ) : (
                <ManualPaymentForm invoiceId={data.id} balance={data.balance} />
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

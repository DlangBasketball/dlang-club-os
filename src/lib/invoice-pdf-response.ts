import { NextResponse } from "next/server";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { getPaymentSettings } from "@/lib/data/payment-settings";
import { buildInvoicePdf, type QrBillSection } from "@/lib/invoice-pdf";
import { buildSpcPayload, formatQrReference } from "@/lib/swiss-payments";

/** Builds and returns the invoice PDF. getInvoiceDetail is RLS-scoped, so the
 *  caller only ever gets a PDF for an invoice they're entitled to see. */
export async function renderInvoicePdf(id: string): Promise<NextResponse> {
  const { data, error } = await getInvoiceDetail(id);
  if (error) return new NextResponse(error, { status: 500 });
  if (!data) return new NextResponse("Not found", { status: 404 });

  const settings = await getPaymentSettings(data.orgId);
  const payIban = (settings.referenceType === "QRR" ? settings.qrIban : settings.iban).replace(/\s/g, "");
  let qrBill: QrBillSection | null = null;
  if (payIban.length > 0 && data.reference) {
    const amount = data.balance > 0 ? data.balance : data.total;
    qrBill = {
      payload: buildSpcPayload({ settings, amount, currency: "CHF", reference: data.reference, debtorName: data.family.contactName ?? data.family.name, message: data.number }),
      iban: settings.referenceType === "QRR" ? settings.qrIban : settings.iban,
      reference: formatQrReference(data.reference),
      creditorLines: [settings.creditorName, `${settings.creditorStreet} ${settings.creditorBuilding}`.trim(), `${settings.creditorZip} ${settings.creditorCity}`.trim()].filter(Boolean),
      debtorLines: [data.family.contactName ?? data.family.name].filter(Boolean) as string[],
      amount,
      currency: "CHF",
    };
  }

  const bytes = await buildInvoicePdf({
    number: data.number, issuedAt: data.issuedAt, dueDate: data.dueDate, status: data.status,
    familyName: data.family.name, contactName: data.family.contactName, contactEmail: data.family.contactEmail,
    items: data.items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, amount: it.amount })),
    total: data.total, paid: data.paid, balance: data.balance, qrBill,
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${data.number}.pdf"` },
  });
}

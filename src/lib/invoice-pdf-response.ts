import { NextResponse } from "next/server";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { getPaymentSettings } from "@/lib/data/payment-settings";
import { buildInvoicePdf, type QrBillSection } from "@/lib/invoice-pdf";
import { buildSpcPayload, formatQrReference, resolveQrBillAccount } from "@/lib/swiss-payments";

/** Builds and returns the invoice PDF. getInvoiceDetail is RLS-scoped, so the
 *  caller only ever gets a PDF for an invoice they're entitled to see. */
export async function renderInvoicePdf(id: string): Promise<NextResponse> {
  const { data, error } = await getInvoiceDetail(id);
  if (error) return new NextResponse(error, { status: 500 });
  if (!data) return new NextResponse("Not found", { status: 404 });

  const settings = await getPaymentSettings(data.orgId);
  let qrBill: QrBillSection | null = null;
  // Swiss QR-bill: CHF or EUR only, CH/LI account matching the invoice's own
  // reference type (SIX implementation guidelines). Only for an open balance:
  // a paid / cancelled invoice must never carry a payable QR code.
  const currency = (data.currency ?? "CHF").toUpperCase();
  const payable = data.balance > 0 && !["paid", "cancelled", "void"].includes(data.status);
  const account = resolveQrBillAccount(settings, data.reference);
  if (payable && account && (currency === "CHF" || currency === "EUR")) {
    const amount = data.balance;
    qrBill = {
      payload: buildSpcPayload({ settings, amount, currency: currency as "CHF" | "EUR", reference: data.reference ?? "", debtorName: data.family.contactName ?? data.family.name, message: data.number }),
      iban: account.iban,
      reference: account.referenceType === "QRR" ? formatQrReference(account.reference) : account.reference,
      creditorLines: [settings.creditorName, `${settings.creditorStreet} ${settings.creditorBuilding}`.trim(), `${settings.creditorZip} ${settings.creditorCity}`.trim()].filter(Boolean),
      debtorLines: [data.family.contactName ?? data.family.name].filter(Boolean) as string[],
      amount,
      currency,
    };
  }

  const bytes = await buildInvoicePdf({
    number: data.number, issuedAt: data.issuedAt, dueDate: data.dueDate, status: data.status,
    familyName: data.family.name, contactName: data.family.contactName, contactEmail: data.family.contactEmail,
    items: data.items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, amount: it.amount })),
    total: data.total, paid: data.paid, balance: data.balance, qrBill,
    club: { name: settings.creditorName, city: settings.creditorCity, country: settings.creditorCountry },
    currency,
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${data.number}.pdf"` },
  });
}

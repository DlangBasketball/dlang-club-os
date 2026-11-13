import { NextResponse } from "next/server";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { buildInvoicePdf, paymentFooterText, type QrBillSection } from "@/lib/invoice-pdf";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeBranding } from "@/lib/tenant/normalize";
import { APP_NAME } from "@/lib/constants";
import { buildSpcPayload, formatQrReference, resolveQrBillAccount } from "@/lib/swiss-payments";
import { getTranslations } from "@/lib/i18n/server";

/** Builds and returns the invoice PDF. getInvoiceDetail is RLS-scoped, so the
 *  caller only ever gets a PDF for an invoice they're entitled to see. */
export async function renderInvoicePdf(id: string): Promise<NextResponse> {
  const { data, error } = await getInvoiceDetail(id);
  if (error) return new NextResponse(error, { status: 500 });
  if (!data) return new NextResponse("Not found", { status: 404 });

  // Tenant payment profile (methods, Swiss creditor settings) + branding.
  const [profile, { data: org }] = await Promise.all([
    getOrgPaymentProfile(data.orgId),
    createAdminClient().from("organizations").select("branding").eq("id", data.orgId).maybeSingle(),
  ]);
  const settings = profile.swiss;
  let qrBill: QrBillSection | null = null;
  // Swiss QR-bill: CHF or EUR only, CH/LI account matching the invoice's own
  // reference type (SIX implementation guidelines). Only for an open balance:
  // a paid / cancelled invoice must never carry a payable QR code.
  const currency = (data.currency ?? "CHF").toUpperCase();
  // The QR amount is the open balance against the amount due (credit / debit
  // notes included); the structured reference never changes.
  const payable = data.balance > 0 && !["paid", "cancelled", "void", "written_off"].includes(data.status);
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

  const branding = normalizeBranding((org as { branding?: unknown } | null)?.branding);
  const t = await getTranslations(data.orgId);
  const adjustments = data.adjustments
    .filter((a) => !a.voidedAt)
    .map((a) => ({
      label: `${t.dynamic(`editMoney.adjust.kinds.${a.kind}`, undefined, a.kind)} ${a.number}`,
      amount: a.kind === "debit_note" ? a.amount : -a.amount,
    }));
  const paymentNote = payable ? paymentFooterText(methodsForInvoice(profile, currency)) : null;

  const bytes = await buildInvoicePdf({
    number: data.number, issuedAt: data.issuedAt, dueDate: data.dueDate, status: data.status,
    familyName: data.family.name, contactName: data.family.contactName, contactEmail: data.family.contactEmail,
    items: data.items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, amount: it.amount })),
    total: data.total, adjustments, paid: data.paid, balance: Math.max(0, data.balance), qrBill,
    club: { name: settings.creditorName, city: settings.creditorCity, country: settings.creditorCountry },
    currency,
    brandColor: branding.colors.primary,
    platformName: APP_NAME,
    paymentNote,
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${data.number}.pdf"` },
  });
}

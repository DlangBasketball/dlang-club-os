import "server-only";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildInvoicePdf, toWinAnsi, type QrBillSection } from "@/lib/invoice-pdf";
import { getOrgPaymentProfile } from "@/lib/payments/settings";
import { buildSpcPayload, resolveQrBillAccount, scorReference } from "@/lib/swiss-payments";
import { normalizeBranding } from "@/lib/tenant/normalize";
import { APP_NAME } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";
import { opsAdminDb, opsDb } from "./db";
import { donorYearTotals } from "./fundraising";

/**
 * PDFs of the operations module, generated for the signed-in admin / finance
 * user. Reads go through the caller's RLS-scoped client first (no access ->
 * 404); only the organisation branding is read with the service role.
 */

/** External invoice (rental, sponsor) with a Swiss QR-bill when the club has a CH/LI IBAN. */
export async function renderOpsInvoicePdf(id: string, orgId: string): Promise<NextResponse> {
  const db = await opsDb();
  const { data: inv } = await db.from("ops_invoices").select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (!inv) return new NextResponse("Not found", { status: 404 });
  const [{ data: lines }, { data: customer }, profile, { data: org }] = await Promise.all([
    db.from("ops_invoice_lines").select("*").eq("invoice_id", id).eq("org_id", orgId).order("sort_order"),
    db.from("ops_customers").select("*").eq("id", inv.customer_id).eq("org_id", orgId).maybeSingle(),
    getOrgPaymentProfile(orgId),
    opsAdminDb().from("organizations").select("branding").eq("id", orgId).maybeSingle(),
  ]);
  const settings = profile.swiss;
  const currency = inv.currency.toUpperCase();
  const balance = inv.status === "paid" || inv.status === "cancelled" ? 0 : inv.total;
  let qrBill: QrBillSection | null = null;
  const reference = scorReference(inv.number.replace(/\D/g, "").slice(-20) || "0");
  const account = resolveQrBillAccount(settings, reference);
  if (balance > 0 && account && (currency === "CHF" || currency === "EUR")) {
    const debtor = customer?.name ?? "";
    qrBill = {
      payload: buildSpcPayload({ settings, amount: balance, currency, reference: account.reference, debtorName: debtor, message: inv.number }),
      iban: account.iban,
      reference: account.reference,
      creditorLines: [settings.creditorName, `${settings.creditorStreet} ${settings.creditorBuilding}`.trim(), `${settings.creditorZip} ${settings.creditorCity}`.trim()].filter(Boolean),
      debtorLines: [debtor, customer?.street ?? "", [customer?.postal_code, customer?.city].filter(Boolean).join(" ")].filter(Boolean),
      amount: balance,
      currency,
    };
  }
  const branding = normalizeBranding((org as { branding?: unknown } | null)?.branding);
  const bytes = await buildInvoicePdf({
    number: inv.number, issuedAt: inv.issued_on, dueDate: inv.due_on, status: inv.status,
    familyName: customer?.name ?? "", contactName: customer?.contact_name ?? null, contactEmail: customer?.email ?? null,
    items: (lines ?? []).map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unit_price), amount: Number(l.amount) })),
    total: inv.total, paid: inv.status === "paid" ? inv.total : 0, balance, qrBill,
    club: { name: settings.creditorName || profile.name, city: settings.creditorCity, country: settings.creditorCountry },
    currency, brandColor: branding.colors.primary, platformName: APP_NAME,
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${inv.number}.pdf"`, "Cache-Control": "private, no-store" },
  });
}

/** Annual donation receipt for one donor (all currencies of that year, one block each). */
export async function renderDonationReceiptPdf(donorId: string, year: number, orgId: string): Promise<NextResponse> {
  const db = await opsDb();
  const { data: donor } = await db.from("ops_customers").select("*").eq("id", donorId).eq("org_id", orgId).maybeSingle();
  if (!donor) return new NextResponse("Not found", { status: 404 });
  const { data: donations } = await db.from("donations").select("amount,currency,status,donor_id,donated_on,purpose")
    .eq("org_id", orgId).eq("donor_id", donorId).gte("donated_on", `${year}-01-01`).lte("donated_on", `${year}-12-31`).order("donated_on");
  const rows = (donations ?? []).map((d) => ({ amount: Number(d.amount), currency: d.currency, status: d.status, donorId: d.donor_id, donatedOn: d.donated_on, purpose: d.purpose }));
  const totals = donorYearTotals(rows, year);
  if (!totals.length) return new NextResponse("Not found", { status: 404 });
  const [{ t, f }, profile] = await Promise.all([getI18n(orgId), getOrgPaymentProfile(orgId)]);
  const bytes = await buildReceipt({
    t, f, year,
    club: { name: profile.swiss.creditorName || profile.name, lines: [`${profile.swiss.creditorStreet} ${profile.swiss.creditorBuilding}`.trim(), `${profile.swiss.creditorZip} ${profile.swiss.creditorCity}`.trim()].filter(Boolean) },
    donor: { name: donor.name, lines: [donor.street ?? "", [donor.postal_code, donor.city].filter(Boolean).join(" ")].filter(Boolean) },
    donations: rows.filter((r) => r.status === "received"),
    totals,
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="donation-receipt-${year}.pdf"`, "Cache-Control": "private, no-store" },
  });
}

async function buildReceipt(d: {
  t: Translator;
  f: Formatter;
  year: number;
  club: { name: string; lines: string[] };
  donor: { name: string; lines: string[] };
  donations: { amount: number; currency: string; donatedOn: string; purpose: string | null }[];
  totals: { currency: string; total: number }[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(font.getCharacterSet());
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  let y = 790;
  const line = (text: string, opts: { size?: number; b?: boolean; color?: typeof ink; x?: number } = {}) => {
    page.drawText(toWinAnsi(text, supported), { x: opts.x ?? 50, y, size: opts.size ?? 10, font: opts.b ? bold : font, color: opts.color ?? ink });
    y -= (opts.size ?? 10) + 6;
  };
  const wrap = (text: string, size = 9, color = muted) => {
    const words = text.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(toWinAnsi(next, supported), size) > 495) {
        line(cur, { size, color });
        cur = w;
      } else cur = next;
    }
    if (cur) line(cur, { size, color });
  };
  line(d.club.name, { size: 14, b: true });
  for (const l of d.club.lines) line(l, { color: muted });
  y -= 18;
  line(d.donor.name, { b: true });
  for (const l of d.donor.lines) line(l);
  y -= 18;
  line(d.t("operations.receipt.title", { year: d.year }), { size: 16, b: true });
  y -= 4;
  wrap(d.t("operations.receipt.intro", { club: d.club.name, donor: d.donor.name, year: d.year }), 10, ink);
  y -= 8;
  for (const r of d.donations.slice(0, 40)) {
    line(`${d.f.date(r.donatedOn)}   ${d.f.money(r.amount, r.currency)}${r.purpose ? `   ${r.purpose.slice(0, 60)}` : ""}`);
  }
  y -= 6;
  for (const tot of d.totals) line(d.t("operations.receipt.total", { amount: d.f.money(tot.total, tot.currency) }), { size: 12, b: true });
  y -= 14;
  wrap(d.t("operations.receipt.noGoods"));
  wrap(d.t("operations.receipt.verify"), 9, rgb(0.6, 0.35, 0.05));
  y -= 24;
  line(d.t("operations.receipt.issued", { date: d.f.date(new Date()) }), { color: muted });
  line(d.t("operations.receipt.signature"), { color: muted });
  return pdf.save();
}

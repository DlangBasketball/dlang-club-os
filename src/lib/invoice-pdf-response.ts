import { NextResponse } from "next/server";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { buildInvoicePdf, paymentFooterText, type QrBillSection } from "@/lib/invoice-pdf";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeBranding } from "@/lib/tenant/normalize";
import { APP_NAME } from "@/lib/constants";
import { applyBillingEntity, buildSpcPayload, formatQrReference, resolveQrBillAccount } from "@/lib/swiss-payments";
import { getI18n } from "@/lib/i18n/server";
import { plansDb } from "@/lib/plans/db";
import { categoryLabelKey } from "@/lib/billing/activities";

/** Builds and returns the invoice PDF. getInvoiceDetail is RLS-scoped, so the
 *  caller only ever gets a PDF for an invoice they're entitled to see.
 *
 *  `installmentId`: QR-bill for ONE instalment of a plan on this invoice. The
 *  invoice keeps its single structured reference (QRR / SCOR); the slip
 *  carries that instalment's open amount. Reconciliation matches the
 *  reference to the invoice and the plan allocates money to the earliest
 *  open instalment, so slips paid out of order still reconcile. */
export async function renderInvoicePdf(id: string, opts: { installmentId?: string | null } = {}): Promise<NextResponse> {
  const { data, error } = await getInvoiceDetail(id);
  if (error) return new NextResponse(error, { status: 500 });
  if (!data) return new NextResponse("Not found", { status: 404 });

  // Instalment row through the caller's session (RLS: guardians + finance only).
  let inst: { seq: number; due_date: string; amount: number; amount_paid: number; status: string; count: number } | null = null;
  if (opts.installmentId && /^[0-9a-f-]{36}$/i.test(opts.installmentId)) {
    const db = await plansDb();
    const { data: row } = await db.from("payment_plan_installments").select("seq,due_date,amount,amount_paid,status,plan_id")
      .eq("id", opts.installmentId).eq("invoice_id", id).maybeSingle();
    if (!row) return new NextResponse("Not found", { status: 404 });
    const { data: plan } = await db.from("payment_plans").select("installment_count").eq("id", row.plan_id).maybeSingle();
    inst = {
      seq: Number(row.seq), due_date: String(row.due_date), amount: Number(row.amount), amount_paid: Number(row.amount_paid ?? 0),
      status: String(row.status), count: Number(plan?.installment_count ?? 0),
    };
  }

  // Tenant payment profile (methods, Swiss creditor settings) + branding, and
  // the invoice's issuing entity (snapshot taken at issue). The invoice was
  // already authorised above (RLS); the service-role read is scoped by id + org.
  const admin = createAdminClient();
  const [profile, { data: org }, { data: billing }] = await Promise.all([
    getOrgPaymentProfile(data.orgId),
    admin.from("organizations").select("branding").eq("id", data.orgId).maybeSingle(),
    admin.from("invoices").select("billing_entity_snapshot,payer_name,payer_kind,payer_id,payer_address,activity,source_label,program_id,programs(series,name)").eq("id", id).eq("org_id", data.orgId).maybeSingle(),
  ]);
  const settings = applyBillingEntity(profile.swiss, billing?.billing_entity_snapshot ?? null);
  // A sponsor / third-party share is addressed to that payer, not the family.
  // A payer record (booking workflow, 20250420104400) is addressed by its snapshot name + address.
  const payerName = billing && (billing.payer_kind === "sponsor" || billing.payer_kind === "other" || billing.payer_id)
    ? billing.payer_name : null;
  const debtor = payerName ?? data.family.contactName ?? data.family.name;
  const addr = (billing?.payer_id ? billing.payer_address : null) as { street?: string | null; postal_code?: string | null; city?: string | null } | null;
  const debtorAddress = addr ? [addr.street ?? "", `${addr.postal_code ?? ""} ${addr.city ?? ""}`.trim()].filter(Boolean) : [];
  let qrBill: QrBillSection | null = null;
  // Swiss QR-bill: CHF or EUR only, CH/LI account matching the invoice's own
  // reference type (SIX implementation guidelines). Only for an open balance:
  // a paid / cancelled invoice must never carry a payable QR code.
  const currency = (data.currency ?? "CHF").toUpperCase();
  // The QR amount is the open balance against the amount due (credit / debit
  // notes included); the structured reference never changes.
  const instOpen = inst && !["paid", "cancelled", "skipped"].includes(inst.status)
    ? Math.min(Math.round((inst.amount - inst.amount_paid) * 1000) / 1000, data.balance) : null;
  const payable = data.balance > 0 && !["paid", "cancelled", "void", "written_off"].includes(data.status) && (inst === null || (instOpen ?? 0) > 0);
  const account = resolveQrBillAccount(settings, data.reference);
  if (payable && account && (currency === "CHF" || currency === "EUR")) {
    const amount = instOpen ?? data.balance;
    qrBill = {
      payload: buildSpcPayload({ settings, amount, currency: currency as "CHF" | "EUR", reference: data.reference ?? "", debtorName: debtor, message: data.number }),
      iban: account.iban,
      reference: account.referenceType === "QRR" ? formatQrReference(account.reference) : account.reference,
      creditorLines: [settings.creditorName, `${settings.creditorStreet} ${settings.creditorBuilding}`.trim(), `${settings.creditorZip} ${settings.creditorCity}`.trim()].filter(Boolean),
      debtorLines: [debtor, ...debtorAddress].filter(Boolean) as string[],
      amount,
      currency,
    };
  }

  const branding = normalizeBranding((org as { branding?: unknown } | null)?.branding);
  const { t, f } = await getI18n(data.orgId);
  // Revenue category (selection: the programme series, e.g. "EYBL") and the printed source.
  type Prog = { series: string | null; name: string } | null;
  const prog = (billing as { programs?: Prog | Prog[] } | null)?.programs;
  const series = (Array.isArray(prog) ? prog[0] : prog)?.series?.trim() || (Array.isArray(prog) ? prog[0] : prog)?.name || null;
  const activity = (billing as { activity?: string } | null)?.activity ?? "other";
  const categoryLabel = activity === "selection" && series ? series : activity === "other" ? null : t(categoryLabelKey(activity));
  const sourceLabel = (billing as { source_label?: string | null } | null)?.source_label ?? null;
  const instalmentNote = inst
    ? t("plans.pdf.note", { seq: inst.seq, count: inst.count, date: f.date(inst.due_date), amount: f.money(instOpen ?? 0, currency) })
    : null;
  const adjustments = data.adjustments
    .filter((a) => !a.voidedAt)
    .map((a) => ({
      label: `${t.dynamic(`editMoney.adjust.kinds.${a.kind}`, undefined, a.kind)} ${a.number}`,
      amount: a.kind === "debit_note" ? a.amount : -a.amount,
    }));
  const paymentNote = payable ? paymentFooterText(methodsForInvoice(profile, currency), t) : null;

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
    instalmentNote,
    categoryLabel,
    sourceLabel,
    i18n: { t, f },
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${data.number}${inst ? `-${inst.seq}` : ""}.pdf"` },
  });
}

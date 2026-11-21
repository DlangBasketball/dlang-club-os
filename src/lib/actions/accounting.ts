"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { writeAudit } from "@/lib/people/server";
import { logError } from "@/lib/log";
import { getStripe } from "@/lib/stripe";
import { getOrgPaymentProfile } from "@/lib/payments/settings";
import { toMinorUnits } from "@/lib/payments/currency";
import { accountingAdminDb, accountingDb } from "@/lib/accounting/db";
import { CamtError, parseCamt } from "@/lib/accounting/camt";
import { matchCredits } from "@/lib/accounting/matching";
import { openInvoicesForMatching } from "@/lib/accounting/data";
import { DEFAULT_ACCOUNTS, DEFAULT_MAPPINGS } from "@/lib/accounting/chart";
import { runOrgAccounting } from "@/lib/accounting/cron";
import {
  BANK_FILE_MAX_BYTES, accountSchema, accountingErrorKey, dunningSchema, firstIssueKey, mappingSchema, monthSchema, pauseSchema,
  policySchema, reasonSchema, refundCreateSchema, refundProcessSchema, reimbursementSchema, supportSchema,
} from "@/lib/accounting/validation";

/**
 * Accounting server actions. Admin / finance of the caller's own club (the
 * org always comes from the session; RLS and the RPCs re-check role and org).
 * Parents only use createRefundRequest (guardian check in the RPC).
 * Money changes go through SECURITY DEFINER RPCs that write audit_logs.
 */
export type AccountingResult = { ok: true; id?: string; message?: string; count?: number } | { ok: false; error: string };

const uuid = z.string().uuid();
type Me = { id: string; orgId: string; roles: string[] };

async function session(): Promise<{ me: Me | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !(await tenantMatchesOrg(me.orgId))) return { me: null, t };
  return { me: me as Me, t };
}
async function requireFinance(): Promise<{ me: Me | null; t: Translator }> {
  const s = await session();
  if (!s.me || !(s.me.roles.includes("admin") || s.me.roles.includes("finance"))) return { me: null, t: s.t };
  return s;
}

const err = (t: Translator, key: string): AccountingResult => ({ ok: false, error: t.dynamic(key, undefined, t("accounting.errors.generic")) });
const denied = (t: Translator) => err(t, "accounting.errors.notPermitted");
const dbErr = (t: Translator, where: string, e: { message?: string } | null | undefined): AccountingResult => {
  const key = accountingErrorKey(e?.message);
  if (key === "accounting.errors.generic") logError(`accounting.${where}`, e);
  return err(t, key);
};
const done = (t: Translator, key: string, extra: { id?: string; count?: number } = {}): AccountingResult =>
  ({ ok: true, message: t.dynamic(key, extra.count != null ? { count: extra.count } : undefined), ...extra });

function refresh(...paths: string[]) {
  revalidatePath("/admin/accounting");
  for (const p of paths) revalidatePath(p);
}

// ---------------------------------------------------------------------------
// Bank files
// ---------------------------------------------------------------------------
export async function importBankFile(form: FormData): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return err(t, "accounting.errors.fileRequired");
  if (file.size > BANK_FILE_MAX_BYTES) return err(t, "accounting.errors.fileTooLarge");
  const buf = Buffer.from(await file.arrayBuffer());
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return err(t, "accounting.errors.fileEncoding");
  }
  let parsed;
  try {
    parsed = parseCamt(xml);
  } catch (e) {
    if (e instanceof CamtError) return err(t, `accounting.errors.camt.${e.code}`);
    logError("accounting.import.parse", e);
    return err(t, "accounting.errors.camt.MALFORMED");
  }
  const invoices = await openInvoicesForMatching(me.orgId);
  const matches = matchCredits(parsed.credits, invoices);
  const autoBook = form.get("autoBook") === "on";
  const db = await accountingDb();
  const { data, error } = await db.rpc("bank_import", {
    p_meta: {
      file_name: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "bank.xml",
      file_sha256: createHash("sha256").update(buf).digest("hex"),
      message_id: parsed.messageId, format: parsed.format, account_last4: parsed.accountLast4,
      statement_from: parsed.from, statement_to: parsed.to, skipped_count: parsed.skipped,
    },
    p_entries: parsed.credits.map((c, i) => ({
      bank_ref: c.bankRef, amount: c.amount, currency: c.currency, booking_date: c.bookingDate, value_date: c.valueDate,
      reference: c.reference, reference_type: c.referenceType, debtor_name: c.debtorName, debtor_iban_last4: c.debtorIbanLast4,
      remittance: c.remittance, suggested_invoice_id: matches[i].kind === "heuristic" ? matches[i].invoiceId : null, score: matches[i].score,
    })),
    p_auto_book: autoBook,
  });
  if (error) return dbErr(t, "import", error);
  const r = (data ?? {}) as { import_id?: string; duplicate_file?: boolean; entries?: number; booked?: number };
  refresh("/admin/accounting/bank", "/admin/invoices", "/admin/finance");
  if (r.duplicate_file) return { ok: true, id: r.import_id, message: t("accounting.bank.duplicateFile") };
  return { ok: true, id: r.import_id, message: t("accounting.bank.imported", { count: r.entries ?? 0, booked: r.booked ?? 0 }) };
}

export async function confirmBankEntry(entryId: string, invoiceId?: string | null): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(entryId).success || (invoiceId && !uuid.safeParse(invoiceId).success)) return err(t, "accounting.errors.invalidRequest");
  const db = await accountingDb();
  const { error } = await db.rpc("bank_entry_confirm", { p_entry: entryId, p_invoice: invoiceId ?? null });
  if (error) return dbErr(t, "confirm", error);
  refresh("/admin/accounting/bank", "/admin/invoices", "/admin/finance");
  return done(t, "accounting.bank.booked");
}

/** Book every reference match of one file (one click). */
export async function confirmReferenceMatches(importId: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(importId).success) return err(t, "accounting.errors.invalidRequest");
  const db = await accountingDb();
  const { data } = await db.from("bank_entries").select("id").eq("org_id", me.orgId).eq("import_id", importId)
    .eq("status", "suggested").eq("match_kind", "reference");
  let n = 0;
  let firstError: { message?: string } | null = null;
  for (const e of data ?? []) {
    const { error } = await db.rpc("bank_entry_confirm", { p_entry: e.id, p_invoice: null });
    if (error) firstError = firstError ?? error; else n += 1;
  }
  refresh("/admin/accounting/bank", "/admin/invoices", "/admin/finance");
  if (firstError && n === 0) return dbErr(t, "confirmAll", firstError);
  return done(t, "accounting.bank.bookedMany", { count: n });
}

export async function ignoreBankEntry(entryId: string, reason: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const r = reasonSchema.safeParse(reason);
  if (!uuid.safeParse(entryId).success || !r.success) return err(t, "accounting.errors.reasonRequired");
  const db = await accountingDb();
  const { error } = await db.rpc("bank_entry_ignore", { p_entry: entryId, p_reason: r.data });
  if (error) return dbErr(t, "ignore", error);
  refresh("/admin/accounting/bank");
  return done(t, "accounting.bank.ignored");
}

export async function reopenBankEntry(entryId: string, reason: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const r = reasonSchema.safeParse(reason);
  if (!uuid.safeParse(entryId).success || !r.success) return err(t, "accounting.errors.reasonRequired");
  const db = await accountingDb();
  const { error } = await db.rpc("bank_entry_reopen", { p_entry: entryId, p_reason: r.data });
  if (error) return dbErr(t, "reopen", error);
  refresh("/admin/accounting/bank", "/admin/invoices", "/admin/finance");
  return done(t, "accounting.bank.reopened");
}

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------
export async function seedDefaultChart(): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const db = await accountingDb();
  const { data, error } = await db.rpc("accounting_seed_chart", {
    p_accounts: DEFAULT_ACCOUNTS.map((a) => ({ number: a.number, name: t.dynamic(`accounting.chart.accounts.${a.number}`, undefined, a.number), type: a.type })),
    p_mappings: DEFAULT_MAPPINGS.map((m) => ({ key: m.key, account_number: m.account, vat_code: m.vatCode ?? null })),
  });
  if (error) return dbErr(t, "seed", error);
  const r = (data ?? {}) as { accounts?: number };
  refresh("/admin/accounting/chart");
  return done(t, "accounting.chart.seeded", { count: Number(r.accounts ?? 0) });
}

export async function saveAccount(id: string | null, input: z.input<typeof accountSchema>): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (id && !uuid.safeParse(id).success) return err(t, "accounting.errors.invalidRequest");
  const p = accountSchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await accountingDb();
  const row = { number: p.data.number, name: p.data.name, type: p.data.type, is_active: p.data.isActive };
  const res = id
    ? await db.from("accounting_accounts").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("accounting_accounts").insert({ ...row, org_id: me.orgId }).select("id");
  if (res.error) return dbErr(t, "saveAccount", res.error);
  if (!res.data?.length) return err(t, "accounting.errors.notFound");
  refresh("/admin/accounting/chart");
  return done(t, "accounting.common.saved", { id: res.data[0].id });
}

export async function deleteAccount(id: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(id).success) return err(t, "accounting.errors.invalidRequest");
  const db = await accountingDb();
  const { data, error } = await db.from("accounting_accounts").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbErr(t, "deleteAccount", error);
  if (!data?.length) return err(t, "accounting.errors.notFound");
  refresh("/admin/accounting/chart");
  return done(t, "accounting.common.deleted");
}

export async function saveMappings(items: z.input<typeof mappingSchema>): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const p = mappingSchema.safeParse(items);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await accountingDb();
  const keep = p.data.filter((m) => m.account || m.vatCode);
  const drop = p.data.filter((m) => !m.account && !m.vatCode).map((m) => m.key);
  if (keep.length) {
    const { error } = await db.from("accounting_mappings").upsert(
      keep.map((m) => ({ org_id: me.orgId, key: m.key, account_number: m.account, vat_code: m.vatCode })),
      { onConflict: "org_id,key" });
    if (error) return dbErr(t, "saveMappings", error);
  }
  if (drop.length) {
    const { error } = await db.from("accounting_mappings").delete().eq("org_id", me.orgId).in("key", drop);
    if (error) return dbErr(t, "saveMappings", error);
  }
  await writeAudit(me, "accounting.mappings.save", "accounting_mappings", null, { saved: keep.length, cleared: drop.length });
  refresh("/admin/accounting/chart");
  return done(t, "accounting.common.saved");
}

// ---------------------------------------------------------------------------
// Period locks
// ---------------------------------------------------------------------------
export async function closePeriod(month: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!monthSchema.safeParse(month).success) return err(t, "accounting.errors.invalidPeriod");
  const db = await accountingDb();
  const { error } = await db.rpc("accounting_close_period", { p_month: `${month}-01` });
  if (error) return dbErr(t, "close", error);
  refresh("/admin/accounting/periods");
  return done(t, "accounting.periods.closed");
}

export async function reopenPeriod(month: string, reason: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!me.roles.includes("admin")) return denied(t);
  const r = reasonSchema.safeParse(reason);
  if (!monthSchema.safeParse(month).success || !r.success) return err(t, "accounting.errors.reasonRequired");
  const db = await accountingDb();
  const { error } = await db.rpc("accounting_reopen_period", { p_month: `${month}-01`, p_reason: r.data });
  if (error) return dbErr(t, "reopenPeriod", error);
  refresh("/admin/accounting/periods");
  return done(t, "accounting.periods.reopened");
}

// ---------------------------------------------------------------------------
// Refund policies and requests
// ---------------------------------------------------------------------------
export async function savePolicy(input: z.input<typeof policySchema>): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const p = policySchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await accountingDb();
  const { error } = await db.from("refund_policies").upsert({
    org_id: me.orgId, product_type: p.data.productType, full_until_days: p.data.fullUntilDays, partial_percent: p.data.partialPercent,
    partial_until_days: p.data.partialUntilDays, medical_mode: p.data.medicalMode, medical_percent: p.data.medicalPercent,
    notes: p.data.notes, is_active: p.data.isActive,
  }, { onConflict: "org_id,product_type" });
  if (error) return dbErr(t, "savePolicy", error);
  refresh("/admin/accounting/refunds", "/parent/refunds");
  return done(t, "accounting.common.saved");
}

/** Parent (own family) or finance: cancel a registration / booking and request the refund. */
export async function createRefundRequest(input: z.input<typeof refundCreateSchema>): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = refundCreateSchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await accountingDb();
  const { data, error } = await db.rpc("refund_request_create", {
    p_payload: {
      registration_id: p.data.registrationId ?? null, booking_id: p.data.bookingId ?? null, invoice_id: p.data.invoiceId ?? null,
      medical: p.data.medical, reason: p.data.reason, preference: p.data.preference ?? null,
      iban: p.data.preference === "bank_refund" ? p.data.iban : null,
      account_holder: p.data.preference === "bank_refund" ? p.data.accountHolder : null,
    },
  });
  if (error) return dbErr(t, "requestRefund", error);
  const id = (data as { request_id?: string } | null)?.request_id;
  refresh("/admin/accounting/refunds", "/parent/refunds", "/admin/registrations", "/parent/children");
  return { ok: true, id, message: t("accounting.refunds.requested") };
}

async function sendStripeRefund(orgId: string, requestId: string, params: { payment_intent: string; account: string | null; amount: number; currency: string; idempotency_key: string }): Promise<{ ok: boolean; error?: string }> {
  const admin = accountingAdminDb();
  const stripe = getStripe();
  let refundId: string | null = null;
  let failure: string | null = null;
  if (!stripe) {
    failure = "stripe_not_configured";
  } else {
    try {
      const profile = await getOrgPaymentProfile(orgId);
      const account = params.account ?? profile.stripeAccountId;
      // Direct charge on the club's connected account: the refund is issued there too.
      const refund = await stripe.refunds.create(
        { payment_intent: params.payment_intent, amount: toMinorUnits(Number(params.amount), params.currency), metadata: { org_id: orgId, refund_request_id: requestId } },
        { ...(account ? { stripeAccount: account } : {}), idempotencyKey: params.idempotency_key },
      );
      refundId = refund.id;
      // Record the negative payment now (idempotent on the refund id; the webhook later is a no-op).
      const { error } = await admin.rpc("apply_stripe_refund", {
        p_payment_intent: params.payment_intent, p_refund_id: refund.id, p_amount: Number(params.amount), p_currency: params.currency, p_account: account ?? null,
      });
      if (error) logError("accounting.refund.apply", error, { orgId });
    } catch (e) {
      failure = e instanceof Error ? e.message.slice(0, 200) : "stripe_error";
      logError("accounting.refund.stripe", e, { orgId });
    }
  }
  const { error } = await admin.rpc("refund_request_stripe_result", { p_request: requestId, p_org: orgId, p_refund_id: refundId, p_error: failure });
  if (error) logError("accounting.refund.result", error, { orgId });
  return refundId ? { ok: true } : { ok: false, error: failure ?? "stripe_error" };
}

export async function processRefund(input: z.input<typeof refundProcessSchema>): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const p = refundProcessSchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await accountingDb();
  const { data, error } = await db.rpc("refund_request_process", {
    p_request: p.data.requestId, p_resolution: p.data.resolution, p_amount: p.data.amount ?? null, p_override_reason: p.data.overrideReason,
  });
  if (error) return dbErr(t, "processRefund", error);
  const r = (data ?? {}) as { stripe?: { payment_intent: string; account: string | null; amount: number; currency: string; idempotency_key: string } };
  if (r.stripe) {
    const s = await sendStripeRefund(me.orgId, p.data.requestId, r.stripe);
    refresh("/admin/accounting/refunds", "/admin/invoices", "/admin/finance");
    return s.ok ? done(t, "accounting.refunds.stripeDone") : err(t, "accounting.refunds.stripeFailed");
  }
  refresh("/admin/accounting/refunds", "/admin/invoices", "/admin/finance");
  return done(t, "accounting.refunds.processed");
}

export async function retryStripeRefund(requestId: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(requestId).success) return err(t, "accounting.errors.invalidRequest");
  const db = await accountingDb();
  const { data, error } = await db.rpc("refund_request_stripe_params", { p_request: requestId });
  if (error) return dbErr(t, "retryRefund", error);
  const s = await sendStripeRefund(me.orgId, requestId, data as { payment_intent: string; account: string | null; amount: number; currency: string; idempotency_key: string });
  refresh("/admin/accounting/refunds", "/admin/invoices");
  return s.ok ? done(t, "accounting.refunds.stripeDone") : err(t, "accounting.refunds.stripeFailed");
}

export async function rejectRefund(requestId: string, reason: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const r = reasonSchema.safeParse(reason);
  if (!uuid.safeParse(requestId).success || !r.success) return err(t, "accounting.errors.reasonRequired");
  const db = await accountingDb();
  const { error } = await db.rpc("refund_request_reject", { p_request: requestId, p_reason: r.data });
  if (error) return dbErr(t, "rejectRefund", error);
  refresh("/admin/accounting/refunds", "/parent/refunds");
  return done(t, "accounting.refunds.rejected");
}

// ---------------------------------------------------------------------------
// Dunning
// ---------------------------------------------------------------------------
export async function saveDunningSettings(input: z.input<typeof dunningSchema>): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const p = dunningSchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await accountingDb();
  const { error } = await db.from("dunning_settings").upsert({
    org_id: me.orgId, enabled: p.data.enabled, level1_days: p.data.level1Days, level2_days: p.data.level2Days, level2_fee: p.data.level2Fee,
    level3_days: p.data.level3Days, level3_fee: p.data.level3Fee, collection_days: p.data.collectionDays, min_balance: p.data.minBalance,
  }, { onConflict: "org_id" });
  if (error) return dbErr(t, "saveDunning", error);
  refresh("/admin/accounting/dunning");
  return done(t, "accounting.common.saved");
}

/** Finance "run now": the same work as the daily cron, for this club only. */
export async function runDunningNow(): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const db = await accountingDb();
  const s = await runOrgAccounting(me.orgId, db);
  refresh("/admin/accounting/dunning", "/admin/invoices", "/admin/finance");
  if (s.errors && !s.notices && !s.supportInvoices) return err(t, "accounting.errors.generic");
  return { ok: true, message: t("accounting.dunning.ran", { notices: s.notices, sent: s.sent, collection: s.collection }) };
}

export async function pauseFamilyDunning(input: z.input<typeof pauseSchema>): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const p = pauseSchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await accountingDb();
  const { error } = await db.from("dunning_family_pauses").upsert({
    org_id: me.orgId, family_id: p.data.familyId, paused_until: p.data.until || null, reason: p.data.reason, created_by: me.id,
  }, { onConflict: "family_id" });
  if (error) return dbErr(t, "pause", error);
  refresh("/admin/accounting/dunning");
  return done(t, "accounting.dunning.paused");
}

export async function resumeFamilyDunning(pauseId: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(pauseId).success) return err(t, "accounting.errors.invalidRequest");
  const db = await accountingDb();
  const { error } = await db.from("dunning_family_pauses").delete().eq("id", pauseId).eq("org_id", me.orgId);
  if (error) return dbErr(t, "resume", error);
  refresh("/admin/accounting/dunning");
  return done(t, "accounting.dunning.resumed");
}

export async function resolveDunningCase(caseId: string, reason: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const r = reasonSchema.safeParse(reason);
  if (!uuid.safeParse(caseId).success || !r.success) return err(t, "accounting.errors.reasonRequired");
  const db = await accountingDb();
  const { error } = await db.rpc("dunning_resolve_case", { p_case: caseId, p_reason: r.data });
  if (error) return dbErr(t, "resolve", error);
  refresh("/admin/accounting/dunning");
  return done(t, "accounting.dunning.resolved");
}

// ---------------------------------------------------------------------------
// Family support + reimbursements
// ---------------------------------------------------------------------------
export async function saveSupport(id: string | null, input: z.input<typeof supportSchema>): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (id && !uuid.safeParse(id).success) return err(t, "accounting.errors.invalidRequest");
  const p = supportSchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await accountingDb();
  const row = {
    name: p.data.name, kind: p.data.kind, value: p.data.value, currency: p.data.kind === "fixed_amount" ? p.data.currency ?? null : null,
    scope: p.data.scope, rule: "family_support", scope_family_id: p.data.familyId, max_amount: p.data.maxAmount, support_reason: p.data.reason,
    valid_from: p.data.validFrom ? `${p.data.validFrom}T00:00:00Z` : null, valid_until: p.data.validUntil ? `${p.data.validUntil}T23:59:59Z` : null,
    stackable: true,
  };
  const res = id
    ? await db.from("discounts").update(row).eq("id", id).eq("org_id", me.orgId).eq("rule", "family_support").select("id")
    : await db.from("discounts").insert({ ...row, org_id: me.orgId, is_active: true, created_by: me.id }).select("id");
  if (res.error) return dbErr(t, "saveSupport", res.error);
  if (!res.data?.length) return err(t, "accounting.errors.notFound");
  refresh("/admin/accounting/support");
  return done(t, "accounting.common.saved", { id: res.data[0].id });
}

export async function setSupportActive(id: string, active: boolean): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(id).success) return err(t, "accounting.errors.invalidRequest");
  const db = await accountingDb();
  const { data, error } = await db.from("discounts").update({ is_active: !!active }).eq("id", id).eq("org_id", me.orgId).eq("rule", "family_support").select("id");
  if (error) return dbErr(t, "supportActive", error);
  if (!data?.length) return err(t, "accounting.errors.notFound");
  refresh("/admin/accounting/support");
  return done(t, "accounting.common.saved");
}

export async function applySupportNow(): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const db = await accountingDb();
  const { data, error } = await db.rpc("family_support_sweep", { p_org: me.orgId });
  if (error) return dbErr(t, "supportSweep", error);
  refresh("/admin/accounting/support", "/admin/invoices", "/admin/finance");
  return done(t, "accounting.support.applied", { count: Number((data as { invoices?: number } | null)?.invoices ?? 0) });
}

export async function saveReimbursement(id: string | null, input: z.input<typeof reimbursementSchema>): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (id && !uuid.safeParse(id).success) return err(t, "accounting.errors.invalidRequest");
  const p = reimbursementSchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await accountingDb();
  const row = {
    funder_kind: p.data.funderKind, funder_name: p.data.funderName, family_id: p.data.familyId ?? null, invoice_id: p.data.invoiceId ?? null,
    period_start: p.data.periodStart ?? null, period_end: p.data.periodEnd ?? null, amount_expected: p.data.amountExpected,
    amount_received: p.data.amountReceived ?? null, currency: p.data.currency, status: p.data.status, requested_on: p.data.requestedOn ?? null,
    received_on: p.data.receivedOn ?? null, reference: p.data.reference, notes: p.data.notes,
  };
  const res = id
    ? await db.from("external_reimbursements").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("external_reimbursements").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbErr(t, "saveReimbursement", res.error);
  if (!res.data?.length) return err(t, "accounting.errors.notFound");
  refresh("/admin/accounting/support");
  return done(t, "accounting.common.saved", { id: res.data[0].id });
}

export async function deleteReimbursement(id: string): Promise<AccountingResult> {
  await assertFeature("accounting");
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(id).success) return err(t, "accounting.errors.invalidRequest");
  const db = await accountingDb();
  const { data, error } = await db.from("external_reimbursements").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbErr(t, "deleteReimbursement", error);
  if (!data?.length) return err(t, "accounting.errors.notDeletable");
  refresh("/admin/accounting/support");
  return done(t, "accounting.common.deleted");
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getLocaleContext, getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { writeAudit } from "@/lib/people/server";
import { logError } from "@/lib/log";
import { financeDb } from "@/lib/finance/db";
import { payoutReport, todayKey } from "@/lib/finance/data";
import {
  EXPENSE_METHODS, RECEIPT_BUCKET, RECEIPT_MAX_BYTES, RECEIPT_TYPES, categoryNameSchema, expenseRow, expenseSchema,
  financeErrorKey, firstIssueKey, isReceiptPathFor, listItemSchema, monthSchema, rateSchema, reasonSchema,
  receiptObjectPath, safeFileName, sniffReceiptType, type ExpenseInput,
} from "@/lib/finance/validation";

/**
 * Finance server actions (expenses, categories, suppliers, receipts, coach
 * pay). Admin and finance of the caller's own club only: the org always comes
 * from the session (profiles.org_id), RLS re-checks role and org in the
 * database, and every change is written to audit_logs (row triggers plus a
 * named action row here).
 */
export type FinanceResult = { ok: true; id?: string; message?: string; count?: number } | { ok: false; error: string };

const uuid = z.string().uuid();
type Staff = { id: string; orgId: string; roles: string[] };

async function requireFinance(): Promise<{ me: Staff | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) return { me: null, t };
  if (!(await tenantMatchesOrg(me.orgId))) return { me: null, t };
  return { me: me as Staff, t };
}

const err = (t: Translator, key: string): FinanceResult => ({ ok: false, error: t.dynamic(key, undefined, t("finance.errors.generic")) });
const denied = (t: Translator) => err(t, "finance.errors.notPermitted");
const dbErr = (t: Translator, where: string, e: { message?: string } | null | undefined): FinanceResult => {
  const key = financeErrorKey(e?.message);
  if (key === "finance.errors.generic") logError(`finance.${where}`, e);
  return err(t, key);
};

function revalidateFinance(extra: string[] = []) {
  revalidatePath("/admin/finance");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance/payouts");
  revalidatePath("/admin/dashboard");
  for (const p of extra) revalidatePath(p);
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export async function saveExpense(id: string | null, input: ExpenseInput): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (id && !uuid.safeParse(id).success) return err(t, "finance.errors.invalidRequest");
  const p = expenseSchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await financeDb();
  if (id) {
    const { data: cur } = await db.from("expenses").select("id,coach_payout_id").eq("id", id).eq("org_id", me.orgId).is("deleted_at", null).maybeSingle();
    if (!cur) return err(t, "finance.errors.notFound");
    if (cur.coach_payout_id) return err(t, "finance.errors.payoutExpense");
  }
  const row = { ...expenseRow(p.data), updated_by: me.id };
  const res = id
    ? await db.from("expenses").update(row).eq("id", id).eq("org_id", me.orgId).is("deleted_at", null).select("id")
    : await db.from("expenses").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbErr(t, "saveExpense", res.error);
  if (!res.data?.length) return err(t, "finance.errors.notFound");
  const newId = res.data[0].id;
  await writeAudit(me, id ? "expense.update" : "expense.create", "expenses", newId, {
    amount: p.data.amount, currency: p.data.currency, status: p.data.status, recurring: p.data.recurringMonthly,
  });
  revalidateFinance([`/admin/finance/expenses/${newId}`]);
  return { ok: true, id: newId, message: t("finance.expenses.saved") };
}

export async function setExpenseStatus(id: string, status: "paid" | "unpaid"): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(id).success || !["paid", "unpaid"].includes(status)) return err(t, "finance.errors.invalidRequest");
  const db = await financeDb();
  const { data: cur } = await db.from("expenses").select("id,coach_payout_id").eq("id", id).eq("org_id", me.orgId).is("deleted_at", null).maybeSingle();
  if (!cur) return err(t, "finance.errors.notFound");
  if (cur.coach_payout_id) return err(t, "finance.errors.payoutExpense");
  const { data, error } = await db.from("expenses")
    .update({ status, paid_on: status === "paid" ? todayKey() : null, updated_by: me.id })
    .eq("id", id).eq("org_id", me.orgId).is("deleted_at", null).select("id");
  if (error) return dbErr(t, "setExpenseStatus", error);
  if (!data?.length) return err(t, "finance.errors.notFound");
  await writeAudit(me, `expense.mark_${status}`, "expenses", id);
  revalidateFinance();
  return { ok: true, id, message: t("finance.expenses.saved") };
}

/** Soft delete with a reason; the row stays for the audit trail. */
export async function deleteExpense(id: string, reason: string): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(id).success) return err(t, "finance.errors.invalidRequest");
  const r = reasonSchema.safeParse(reason);
  if (!r.success) return err(t, firstIssueKey(r.error));
  const db = await financeDb();
  const { data: cur } = await db.from("expenses").select("id,coach_payout_id").eq("id", id).eq("org_id", me.orgId).is("deleted_at", null).maybeSingle();
  if (!cur) return err(t, "finance.errors.notFound");
  if (cur.coach_payout_id) return err(t, "finance.errors.payoutExpense");
  const { data, error } = await db.from("expenses")
    .update({ deleted_at: new Date().toISOString(), deleted_by: me.id, delete_reason: r.data, updated_by: me.id })
    .eq("id", id).eq("org_id", me.orgId).is("deleted_at", null).select("id");
  if (error) return dbErr(t, "deleteExpense", error);
  if (!data?.length) return err(t, "finance.errors.notFound");
  await writeAudit(me, "expense.delete", "expenses", id, { reason: r.data });
  revalidateFinance();
  return { ok: true, message: t("finance.expenses.deleted") };
}

/** Posts the monthly copies of recurring expenses up to today. */
export async function generateRecurringExpenses(): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const db = await financeDb();
  const { data, error } = await db.rpc("generate_recurring_expenses", { p_until: todayKey() });
  if (error) return dbErr(t, "generateRecurring", error);
  const n = Number(data ?? 0);
  revalidateFinance();
  return { ok: true, count: n, message: t("finance.expenses.recurringPosted", { count: n }) };
}

// ---------------------------------------------------------------------------
// Receipts (private bucket, signed URLs only)
// ---------------------------------------------------------------------------
export async function uploadExpenseReceipt(formData: FormData): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const id = String(formData.get("expenseId") ?? "");
  if (!uuid.safeParse(id).success) return err(t, "finance.errors.invalidRequest");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return err(t, "finance.errors.noFile");
  if (file.size > RECEIPT_MAX_BYTES) return err(t, "finance.errors.fileTooLarge");
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) return err(t, "finance.errors.fileType");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffReceiptType(bytes);
  if (!type || type !== file.type) return err(t, "finance.errors.fileType");

  const db = await financeDb();
  const { data: cur } = await db.from("expenses").select("id,receipt_path").eq("id", id).eq("org_id", me.orgId).is("deleted_at", null).maybeSingle();
  if (!cur) return err(t, "finance.errors.notFound");
  const path = receiptObjectPath(me.orgId, id, type, crypto.randomUUID());
  const up = await db.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (up.error) {
    logError("finance.receipt.upload", up.error);
    return err(t, "finance.errors.uploadFailed");
  }
  const name = safeFileName(file.name);
  const { error } = await db.from("expenses").update({ receipt_path: path, receipt_name: name, receipt_type: type, updated_by: me.id })
    .eq("id", id).eq("org_id", me.orgId).is("deleted_at", null);
  if (error) {
    await db.storage.from(RECEIPT_BUCKET).remove([path]);
    return dbErr(t, "receipt.row", error);
  }
  if (cur.receipt_path && cur.receipt_path !== path && isReceiptPathFor(cur.receipt_path, me.orgId, id)) {
    const rm = await db.storage.from(RECEIPT_BUCKET).remove([cur.receipt_path]);
    if (rm.error) logError("finance.receipt.removeOld", rm.error);
  }
  await writeAudit(me, cur.receipt_path ? "expense.receipt.replace" : "expense.receipt.upload", "expenses", id, { size_bytes: bytes.byteLength, type });
  revalidateFinance([`/admin/finance/expenses/${id}`]);
  return { ok: true, id, message: t("finance.receipt.uploaded") };
}

export async function removeExpenseReceipt(id: string): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(id).success) return err(t, "finance.errors.invalidRequest");
  const db = await financeDb();
  const { data: cur } = await db.from("expenses").select("id,receipt_path").eq("id", id).eq("org_id", me.orgId).is("deleted_at", null).maybeSingle();
  if (!cur) return err(t, "finance.errors.notFound");
  if (!cur.receipt_path) return { ok: true, message: t("finance.receipt.removed") };
  const { error } = await db.from("expenses").update({ receipt_path: null, receipt_name: null, receipt_type: null, updated_by: me.id })
    .eq("id", id).eq("org_id", me.orgId);
  if (error) return dbErr(t, "receipt.remove", error);
  if (isReceiptPathFor(cur.receipt_path, me.orgId, id)) {
    const rm = await db.storage.from(RECEIPT_BUCKET).remove([cur.receipt_path]);
    if (rm.error) logError("finance.receipt.remove", rm.error);
  }
  await writeAudit(me, "expense.receipt.remove", "expenses", id);
  revalidateFinance([`/admin/finance/expenses/${id}`]);
  return { ok: true, message: t("finance.receipt.removed") };
}

// ---------------------------------------------------------------------------
// Categories and suppliers (editable lists)
// ---------------------------------------------------------------------------
type ListKind = "category" | "supplier";
const TABLE: Record<ListKind, "expense_categories" | "expense_suppliers"> = { category: "expense_categories", supplier: "expense_suppliers" };

export async function saveListItem(kind: ListKind, id: string | null, input: { name: string; contact?: string | null; notes?: string | null }): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!(kind in TABLE) || (id && !uuid.safeParse(id).success)) return err(t, "finance.errors.invalidRequest");
  const p = kind === "category"
    ? categoryNameSchema.safeParse(input.name)
    : listItemSchema.safeParse(input);
  if (!p.success) return err(t, firstIssueKey(p.error));
  const row = kind === "category"
    ? { name: p.data as string }
    : (() => { const v = p.data as z.output<typeof listItemSchema>; return { name: v.name, contact: v.contact, notes: v.notes }; })();
  const db = await financeDb();
  const res = id
    ? await db.from(TABLE[kind]).update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from(TABLE[kind]).insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbErr(t, "saveListItem", res.error);
  if (!res.data?.length) return err(t, "finance.errors.notFound");
  await writeAudit(me, `expense_${kind}.${id ? "update" : "create"}`, TABLE[kind], res.data[0].id);
  revalidateFinance();
  return { ok: true, id: res.data[0].id, message: t("finance.lists.saved") };
}

export async function setListItemActive(kind: ListKind, id: string, active: boolean): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!(kind in TABLE) || !uuid.safeParse(id).success) return err(t, "finance.errors.invalidRequest");
  const db = await financeDb();
  const { data, error } = await db.from(TABLE[kind]).update({ is_active: !!active }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbErr(t, "setListItemActive", error);
  if (!data?.length) return err(t, "finance.errors.notFound");
  await writeAudit(me, `expense_${kind}.${active ? "activate" : "deactivate"}`, TABLE[kind], id);
  revalidateFinance();
  return { ok: true, id };
}

/** Deletes an unused entry; one that an expense uses is deactivated instead. */
export async function deleteListItem(kind: ListKind, id: string): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!(kind in TABLE) || !uuid.safeParse(id).success) return err(t, "finance.errors.invalidRequest");
  const db = await financeDb();
  const col = kind === "category" ? "category_id" : "supplier_id";
  const { count } = await db.from("expenses").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq(col, id);
  if ((count ?? 0) > 0) {
    const res = await setListItemActive(kind, id, false);
    return res.ok ? { ok: true, id, message: t("finance.lists.deactivatedInstead") } : res;
  }
  const { data, error } = await db.from(TABLE[kind]).delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbErr(t, "deleteListItem", error);
  if (!data?.length) return err(t, "finance.errors.notFound");
  await writeAudit(me, `expense_${kind}.delete`, TABLE[kind], id);
  revalidateFinance();
  return { ok: true, message: t("finance.lists.deleted") };
}

// ---------------------------------------------------------------------------
// Coach pay rates and payouts
// ---------------------------------------------------------------------------
export async function saveCoachRate(input: { coachId: string; rateType: string; amount: number | string; currency?: string; notes?: string | null }): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  const ctx = await getLocaleContext();
  const p = rateSchema.safeParse({ ...input, currency: input.currency || ctx.currency });
  if (!p.success) return err(t, firstIssueKey(p.error));
  const db = await financeDb();
  const { data: coach } = await db.from("coaches").select("id").eq("id", p.data.coachId).eq("org_id", me.orgId).maybeSingle();
  if (!coach) return err(t, "finance.errors.notFound");
  const { data, error } = await db.from("coach_pay_rates").upsert({
    org_id: me.orgId, coach_id: p.data.coachId, rate_type: p.data.rateType, amount: p.data.amount, currency: p.data.currency,
    notes: p.data.notes, created_by: me.id,
  }, { onConflict: "coach_id" }).select("id");
  if (error) return dbErr(t, "saveCoachRate", error);
  await writeAudit(me, "coach_rate.save", "coach_pay_rates", data?.[0]?.id ?? null, { coach_id: p.data.coachId, rate_type: p.data.rateType, amount: p.data.amount });
  revalidateFinance();
  return { ok: true, message: t("finance.payouts.rateSaved") };
}

export async function removeCoachRate(coachId: string): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(coachId).success) return err(t, "finance.errors.invalidRequest");
  const db = await financeDb();
  const { error } = await db.from("coach_pay_rates").delete().eq("coach_id", coachId).eq("org_id", me.orgId);
  if (error) return dbErr(t, "removeCoachRate", error);
  await writeAudit(me, "coach_rate.remove", "coach_pay_rates", null, { coach_id: coachId });
  revalidateFinance();
  return { ok: true, message: t("finance.payouts.rateRemoved") };
}

/**
 * Marks a coach's month as paid. The amount is recomputed here from the
 * same report the user saw (never taken from the client), then
 * record_coach_payout books the payout and its expense in one transaction.
 */
export async function markPayoutPaid(coachId: string, month: string, paidOn: string, method: string): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(coachId).success) return err(t, "finance.errors.invalidRequest");
  const m = monthSchema.safeParse(month);
  if (!m.success) return err(t, firstIssueKey(m.error));
  if (!(EXPENSE_METHODS as readonly string[]).includes(method)) return err(t, "finance.errors.method");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return err(t, "finance.errors.date");
  const report = await payoutReport(me.orgId, m.data);
  if (report.error !== null) return dbErr(t, "markPayoutPaid.report", { message: report.error });
  const line = report.data.find((l) => l.coachId === coachId);
  if (!line) return err(t, "finance.errors.notFound");
  if (line.payout) return err(t, "finance.errors.alreadyPaid");
  if (!line.rate || !line.calc) return err(t, "finance.errors.noRate");
  if (line.calc.amount <= 0) return err(t, "finance.errors.nothingToPay");
  const db = await financeDb();
  const { data, error } = await db.rpc("record_coach_payout", {
    p_coach: coachId, p_month: `${m.data}-01`, p_amount: line.calc.amount, p_currency: line.rate.currency,
    p_rate_type: line.rate.rateType, p_rate_amount: line.rate.amount, p_sessions: line.activity.sessions,
    p_bookings: line.activity.bookings, p_minutes: line.calc.minutes, p_clock_minutes: line.clockMinutes,
    p_breakdown: { ...line.activity, basis: line.calc.basis, units: line.calc.units },
    p_paid_on: paidOn, p_method: method,
    p_category_name: t("finance.payouts.categoryName"),
    p_description: t("finance.payouts.expenseDescription", { coach: line.coachName, month: m.data }),
  });
  if (error) return dbErr(t, "markPayoutPaid", error);
  const res = (data ?? {}) as { payout_id?: string };
  await writeAudit(me, "coach_payout.mark_paid", "coach_payouts", res.payout_id ?? null, { coach_id: coachId, month: m.data, amount: line.calc.amount });
  revalidateFinance();
  return { ok: true, id: res.payout_id, message: t("finance.payouts.paid") };
}

export async function voidPayout(payoutId: string, reason: string): Promise<FinanceResult> {
  const { me, t } = await requireFinance();
  if (!me) return denied(t);
  if (!uuid.safeParse(payoutId).success) return err(t, "finance.errors.invalidRequest");
  const r = reasonSchema.safeParse(reason);
  if (!r.success) return err(t, firstIssueKey(r.error));
  const db = await financeDb();
  const { error } = await db.rpc("void_coach_payout", { p_payout: payoutId, p_reason: r.data });
  if (error) return dbErr(t, "voidPayout", error);
  revalidateFinance();
  return { ok: true, message: t("finance.payouts.voided") };
}

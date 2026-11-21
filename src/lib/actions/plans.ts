"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import type { Json } from "@/types/database";
import { logError } from "@/lib/log";
import { getStripe } from "@/lib/stripe";
import { createInvoiceCheckout } from "@/lib/stripe-connect";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { ALLOWED_COUNTS, PRODUCT_TYPES } from "@/lib/payments/plans";
import { plansDb } from "@/lib/plans/db";
import { loadPlanSettings } from "@/lib/plans/settings";
import { createAutopaySetupSession, detachPaymentMethod } from "@/lib/plans/autopay";
import { chargeInstalmentNow, runOrgBilling } from "@/lib/plans/cron";
import { clubToday } from "@/lib/plans/data";

/*
 * Instalment plans, recurring fees and autopay — server actions.
 * Org always from the session (profiles.org_id); every RPC re-checks role +
 * target org in SQL (SECURITY DEFINER), writes audit_logs and never sees card
 * data (Stripe-hosted pages only). Parents act only on their own family
 * (is_guardian_of_family in SQL); admin / finance on their own club.
 */
export type PlanResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reason = z.string().trim().min(1).max(500);

/** Error codes raised by the plan RPCs that have a translated message under plans.errors. */
const CODES = [
  "NOT_AUTHORIZED", "INVOICE_NOT_FOUND", "INVOICE_IS_DRAFT", "INVOICE_NOT_PAYABLE", "PLAN_EXISTS", "PLANS_DISABLED",
  "PRODUCT_NOT_ELIGIBLE", "COUNT_NOT_ALLOWED", "NOTHING_OUTSTANDING", "BELOW_MINIMUM", "SCHEDULE_UNAVAILABLE",
  "LAST_AFTER_DEADLINE", "TOTAL_MISMATCH", "INVALID_SCHEDULE", "INVALID_COUNT", "PLAN_NOT_FOUND", "PLAN_CLOSED",
  "NOT_INSTALMENT_PLAN", "INSTALMENT_NOT_FOUND", "INSTALMENT_LOCKED", "BELOW_PAID", "REASON_REQUIRED",
  "TEMPLATE_NOT_FOUND", "TEMPLATE_INACTIVE", "TEAM_NOT_FOUND", "PROGRAM_NOT_FOUND", "INVALID_DATE", "INVALID_AMOUNT",
  "NOT_RECURRING", "INVALID_KIND", "PAUSE_NOT_FOUND", "ALREADY_SKIPPED", "USE_CREDIT_NOTE", "INVALID_PERIOD",
  "FAMILY_NOT_FOUND", "AUTOPAY_DISABLED", "CONSENT_REQUIRED", "CONSENT_OUTDATED", "MANDATE_NOT_FOUND",
  "MANDATE_NOT_ACTIVE", "NOT_FAILED", "ONLINE_UNAVAILABLE",
] as const;

type Failure = { ok: false; error: string };

function fail(t: Translator, error: { message?: string } | string | null | undefined): Failure {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = CODES.find((c) => new RegExp(`\\b${c}\\b`).test(msg));
  if (code) return { ok: false, error: t.dynamic(`plans.errors.${code}`, undefined, t("plans.errors.generic")) };
  if (msg) logError("plans.action", msg);
  return { ok: false, error: t("plans.errors.generic") };
}
const invalid = (t: Translator): Failure => ({ ok: false, error: t("plans.errors.invalidInput") });
const denied = (t: Translator): Failure => ({ ok: false, error: t("plans.errors.NOT_AUTHORIZED") });

async function staff(): Promise<{ me: SessionUser & { orgId: string }; t: Translator } | { me: null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) return { me: null, t };
  return { me: me as SessionUser & { orgId: string }, t };
}

async function member(): Promise<{ me: SessionUser & { orgId: string }; t: Translator } | { me: null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId) return { me: null, t };
  return { me: me as SessionUser & { orgId: string }, t };
}

function revalidatePlans(invoiceIds: (string | null | undefined)[] = []) {
  for (const id of invoiceIds) {
    if (!id) continue;
    revalidatePath(`/admin/invoices/${id}`);
    revalidatePath(`/parent/invoices/${id}`);
  }
  revalidatePath("/admin/payment-plans");
  revalidatePath("/admin/recurring-fees");
  revalidatePath("/admin/invoices");
  revalidatePath("/parent/invoices");
  revalidatePath("/parent/payment-plans");
}

// ===========================================================================
// Club settings (admin / finance)
// ===========================================================================
const settingsSchema = z.object({
  enabled: z.boolean(),
  productTypes: z.array(z.enum(PRODUCT_TYPES as unknown as [string, ...string[]])).max(5),
  allowedCounts: z.array(z.coerce.number().int().refine((n) => (ALLOWED_COUNTS as readonly number[]).includes(n))).min(1).max(12),
  minAmount: z.coerce.number().min(0).max(1_000_000),
  feeKind: z.enum(["none", "fixed", "percent"]),
  feeValue: z.coerce.number().min(0).max(10_000),
  firstAtSignup: z.boolean(),
  scheduleKind: z.enum(["monthly", "custom"]),
  dayOfMonth: z.coerce.number().int().min(1).max(31),
  customDates: z.array(isoDate).max(24),
  campLastDaysBefore: z.union([z.literal(""), z.null(), z.coerce.number().int().min(0).max(365)]).optional().transform((v) => (v === "" || v == null ? null : v)),
  autopayEnabled: z.boolean(),
  retryDays: z.array(z.coerce.number().int().min(1).max(30)).max(5),
  remindBeforeDays: z.coerce.number().int().min(0).max(30),
  overdueRepeatDays: z.coerce.number().int().min(1).max(60),
  mandateVersion: z.string().trim().min(1).max(20),
}).refine((v) => v.feeKind !== "percent" || v.feeValue <= 20, { path: ["feeValue"] });
export type PlanSettingsInput = z.input<typeof settingsSchema>;

export async function savePlanSettings(input: PlanSettingsInput): Promise<PlanResult> {
  await assertFeature("payment_plans");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const p = settingsSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const v = p.data;
  const db = await plansDb();
  const row = {
    org_id: me.orgId, enabled: v.enabled, product_types: Array.from(new Set(v.productTypes)),
    allowed_counts: Array.from(new Set(v.allowedCounts)).sort((a, b) => a - b), min_amount: v.minAmount, fee_kind: v.feeKind,
    fee_value: v.feeKind === "none" ? 0 : v.feeValue, first_at_signup: v.firstAtSignup, schedule_kind: v.scheduleKind,
    day_of_month: v.dayOfMonth, custom_dates: Array.from(new Set(v.customDates)).sort(), camp_last_days_before: v.campLastDaysBefore,
    autopay_enabled: v.autopayEnabled, retry_days: Array.from(new Set(v.retryDays)).sort((a, b) => a - b),
    remind_before_days: v.remindBeforeDays, overdue_repeat_days: v.overdueRepeatDays, mandate_version: v.mandateVersion,
  };
  const { error } = await db.from("payment_plan_settings").upsert(row, { onConflict: "org_id" });
  if (error) return fail(t, error);
  revalidatePath("/admin/payment-plans/settings");
  revalidatePath("/admin/payment-plans");
  return { ok: true, message: t("plans.settings.saved") };
}

// ===========================================================================
// Instalment plans on an invoice
// ===========================================================================
/** Parent (own family) or finance: split an open invoice by the club's rules. */
export async function choosePlan(invoiceId: string, count: number): Promise<PlanResult> {
  await assertFeature("payment_plans");
  const { me, t } = await member();
  if (!me) return denied(t);
  const id = uuid.safeParse(invoiceId);
  const n = z.coerce.number().int().min(2).max(24).safeParse(count);
  if (!id.success || !n.success) return invalid(t);
  const db = await plansDb();
  const { error } = await db.rpc("plan_choose", { p_invoice: id.data, p_count: n.data });
  if (error) return fail(t, error);
  revalidatePlans([id.data]);
  return { ok: true, message: t("plans.choose.done", { count: n.data }) };
}

const customSchema = z.object({
  dates: z.array(isoDate).min(2).max(60),
  amounts: z.array(z.coerce.number().finite().min(0)).min(2).max(60),
  fee: z.coerce.number().min(0).max(10_000).default(0),
}).refine((v) => v.dates.length === v.amounts.length);
export type CustomPlanInput = z.input<typeof customSchema>;

/** Finance: any schedule on an open invoice (amounts must add up to balance + fee). */
export async function adminCreatePlan(invoiceId: string, input: CustomPlanInput): Promise<PlanResult> {
  await assertFeature("payment_plans");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const id = uuid.safeParse(invoiceId);
  const p = customSchema.safeParse(input);
  if (!id.success || !p.success) return invalid(t);
  const db = await plansDb();
  const { error } = await db.rpc("plan_admin_create", { p_invoice: id.data, p_dates: p.data.dates, p_amounts: p.data.amounts, p_fee: p.data.fee });
  if (error) return fail(t, error);
  revalidatePlans([id.data]);
  return { ok: true, message: t("plans.admin.created") };
}

const rescheduleSchema = z.object({
  items: z.array(z.object({ id: uuid, due_date: isoDate.optional(), amount: z.coerce.number().finite().min(0).optional() })).min(1).max(60),
  reason: z.string().trim().max(500).optional().default(""),
});
export type RescheduleInput = z.input<typeof rescheduleSchema>;

export async function reschedulePlan(planId: string, input: RescheduleInput): Promise<PlanResult> {
  await assertFeature("payment_plans");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const id = uuid.safeParse(planId);
  const p = rescheduleSchema.safeParse(input);
  if (!id.success || !p.success) return invalid(t);
  const db = await plansDb();
  const { data, error } = await db.rpc("plan_reschedule", { p_plan: id.data, p_items: p.data.items as unknown as Json, p_reason: p.data.reason || null });
  if (error) return fail(t, error);
  void data;
  revalidatePath(`/admin/payment-plans/${id.data}`);
  revalidatePlans();
  return { ok: true, message: t("plans.admin.rescheduled") };
}

export async function setPlanPaused(planId: string, paused: boolean, why = ""): Promise<PlanResult> {
  await assertFeature("payment_plans");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const id = uuid.safeParse(planId);
  if (!id.success) return invalid(t);
  const db = await plansDb();
  const { error } = await db.rpc("plan_set_paused", { p_plan: id.data, p_paused: Boolean(paused), p_reason: why.trim().slice(0, 500) || null });
  if (error) return fail(t, error);
  revalidatePath(`/admin/payment-plans/${id.data}`);
  revalidatePlans();
  return { ok: true, message: t(paused ? "plans.admin.paused" : "plans.admin.resumed") };
}

export async function cancelPlan(planId: string, why: string): Promise<PlanResult> {
  await assertFeature("payment_plans");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const id = uuid.safeParse(planId);
  const r = reason.safeParse(why);
  if (!id.success) return invalid(t);
  if (!r.success) return fail(t, "REASON_REQUIRED");
  const db = await plansDb();
  const { data: plan } = await db.from("payment_plans").select("invoice_id").eq("id", id.data).maybeSingle();
  const { error } = await db.rpc("plan_cancel", { p_plan: id.data, p_reason: r.data });
  if (error) return fail(t, error);
  revalidatePath(`/admin/payment-plans/${id.data}`);
  revalidatePlans([plan?.invoice_id]);
  return { ok: true, message: t("plans.admin.cancelled") };
}

/** Card / TWINT payment of one instalment via Stripe Checkout (parent or finance). */
export async function payInstalment(installmentId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { me, t } = await member();
  if (!me) return denied(t);
  const id = uuid.safeParse(installmentId);
  if (!id.success) return invalid(t);
  const db = await plansDb();
  // RLS: only the family's guardians and the club's finance see the row.
  const { data: inst } = await db.from("payment_plan_installments").select("id,plan_id,invoice_id,seq,status,amount,amount_paid,currency").eq("id", id.data).maybeSingle();
  if (!inst?.invoice_id || inst.status === "paid" || inst.status === "cancelled" || inst.status === "skipped") return fail(t, "INSTALMENT_NOT_FOUND");
  const [{ data: inv }, { data: plan }, { data: outstanding }] = await Promise.all([
    db.from("invoices").select("id,org_id,number,currency,status").eq("id", inst.invoice_id).maybeSingle(),
    db.from("payment_plans").select("installment_count,kind").eq("id", inst.plan_id).maybeSingle(),
    db.rpc("plan_invoice_context", { p_invoice: inst.invoice_id }),
  ]);
  if (!inv || inv.org_id !== me.orgId) return fail(t, "INSTALMENT_NOT_FOUND");
  const balance = Number((outstanding as { balance?: number } | null)?.balance ?? 0);
  const due = Math.min(Number(inst.amount) - Number(inst.amount_paid), balance);
  if (!(due > 0)) return fail(t, "NOTHING_OUTSTANDING");
  if (!getStripe()) return fail(t, "ONLINE_UNAVAILABLE");
  const profile = await getOrgPaymentProfile(inv.org_id);
  const methods = methodsForInvoice(profile, inv.currency ?? profile.currency).filter((m) => m.via === "stripe");
  if (!profile.stripeReady || !methods.length) return fail(t, "ONLINE_UNAVAILABLE");
  try {
    const url = await createInvoiceCheckout({
      profile, invoiceId: inv.id, invoiceNumber: inv.number, currency: inv.currency ?? profile.currency, amount: due, methods,
      customerEmail: me.email, installmentId: inst.id,
      label: plan?.kind === "installments"
        ? t("plans.checkout.label", { club: profile.name, invoice: inv.number, seq: inst.seq, count: Number(plan?.installment_count ?? 0) })
        : t("plans.checkout.periodLabel", { club: profile.name, invoice: inv.number }),
      returnPath: me.roles.includes("parent") ? `/parent/invoices/${inv.id}` : `/admin/invoices/${inv.id}`,
    });
    return { ok: true, url };
  } catch (e) {
    logError("plans.payInstalment", e);
    return fail(t, "ONLINE_UNAVAILABLE");
  }
}

/** Pay everything still open on an instalment plan in one Stripe Checkout
 *  (card / TWINT). The payment is applied to the earliest open instalments
 *  first, so the remaining instalments close and autopay won't charge them. */
export async function payPlanBalance(planId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { me, t } = await member();
  if (!me) return denied(t);
  const id = uuid.safeParse(planId);
  if (!id.success) return invalid(t);
  const db = await plansDb();
  // RLS: only the family's guardians and the club's finance/admin see the plan.
  const { data: plan } = await db.from("payment_plans").select("id,invoice_id,kind,status").eq("id", id.data).maybeSingle();
  if (!plan?.invoice_id || plan.kind !== "installments" || plan.status === "cancelled") return fail(t, "INSTALMENT_NOT_FOUND");
  const [{ data: inv }, { data: outstanding }] = await Promise.all([
    db.from("invoices").select("id,org_id,number,currency,status").eq("id", plan.invoice_id).maybeSingle(),
    db.rpc("plan_invoice_context", { p_invoice: plan.invoice_id }),
  ]);
  if (!inv || inv.org_id !== me.orgId) return fail(t, "INSTALMENT_NOT_FOUND");
  const balance = Number((outstanding as { balance?: number } | null)?.balance ?? 0);
  if (!(balance > 0)) return fail(t, "NOTHING_OUTSTANDING");
  if (!getStripe()) return fail(t, "ONLINE_UNAVAILABLE");
  const profile = await getOrgPaymentProfile(inv.org_id);
  const methods = methodsForInvoice(profile, inv.currency ?? profile.currency).filter((m) => m.via === "stripe");
  if (!profile.stripeReady || !methods.length) return fail(t, "ONLINE_UNAVAILABLE");
  try {
    const url = await createInvoiceCheckout({
      profile, invoiceId: inv.id, invoiceNumber: inv.number, currency: inv.currency ?? profile.currency, amount: balance, methods,
      customerEmail: me.email,
      label: t("plans.checkout.balanceLabel", { club: profile.name, invoice: inv.number }),
      returnPath: me.roles.includes("parent") ? `/parent/invoices/${inv.id}` : `/admin/invoices/${inv.id}`,
    });
    return { ok: true, url };
  } catch (e) {
    logError("plans.payPlanBalance", e);
    return fail(t, "ONLINE_UNAVAILABLE");
  }
}

// ===========================================================================
// Recurring fees (admin / finance)
// ===========================================================================
const optUuid = z.union([z.literal(""), z.null(), uuid]).optional().transform((v) => v || null);
const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().default(""),
  amount: z.coerce.number().positive().max(1_000_000),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()),
  frequency: z.enum(["monthly", "quarterly", "yearly"]),
  billingDay: z.coerce.number().int().min(1).max(31),
  startDate: isoDate,
  endDate: z.union([z.literal(""), isoDate]).optional().default(""),
  programId: optUuid,
  teamId: optUuid,
  proration: z.enum(["none", "daily", "half_month"]),
  dueDays: z.coerce.number().int().min(0).max(120),
  applyDiscounts: z.boolean().default(true),
  isActive: z.boolean().default(true),
  applyToEnrolments: z.boolean().default(false),
}).refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ["endDate"] });
export type TemplateInput = z.input<typeof templateSchema>;

export async function saveRecurringTemplate(id: string | null, input: TemplateInput): Promise<PlanResult<{ id: string }>> {
  await assertFeature("recurring_fees");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const p = templateSchema.safeParse(input);
  if (!p.success || (id && !uuid.safeParse(id).success)) return invalid(t);
  const v = p.data;
  const row = {
    name: v.name, description: v.description || null, amount: v.amount, currency: v.currency, frequency: v.frequency,
    billing_day: v.billingDay, start_date: v.startDate, end_date: v.endDate || null, program_id: v.programId, team_id: v.teamId,
    proration: v.proration, due_days: v.dueDays, apply_discounts: v.applyDiscounts, is_active: v.isActive,
  };
  const db = await plansDb();
  let savedId = id;
  if (id) {
    const { error } = await db.from("recurring_fee_templates").update(row).eq("id", id).eq("org_id", me.orgId);
    if (error) return fail(t, error);
    if (v.applyToEnrolments) {
      // New amount for the next periods of every running enrolment (already issued invoices are untouched).
      const { error: e2 } = await db.from("payment_plans").update({ amount_per_period: v.amount, description: v.name })
        .eq("template_id", id).eq("org_id", me.orgId).in("status", ["active", "paused"]);
      if (e2) return fail(t, e2);
    }
  } else {
    const { data, error } = await db.from("recurring_fee_templates").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id").single();
    if (error) return fail(t, error);
    savedId = (data as { id: string }).id;
  }
  revalidatePath("/admin/recurring-fees");
  return { ok: true, message: t("plans.recurring.saved"), data: { id: savedId ?? "" } };
}

export async function enrolAthletes(templateId: string, athleteIds: string[], start: string): Promise<PlanResult<{ count: number }>> {
  await assertFeature("recurring_fees");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const p = z.object({ templateId: uuid, athleteIds: z.array(uuid).min(1).max(500), start: isoDate }).safeParse({ templateId, athleteIds, start });
  if (!p.success) return invalid(t);
  const db = await plansDb();
  const { data, error } = await db.rpc("recurring_enrol", { p_template: p.data.templateId, p_athletes: p.data.athleteIds, p_start: p.data.start });
  if (error) return fail(t, error);
  revalidatePath("/admin/recurring-fees");
  return { ok: true, message: t("plans.recurring.enrolled", { count: Number(data ?? 0) }), data: { count: Number(data ?? 0) } };
}

export async function enrolTeam(templateId: string, teamId: string, start: string): Promise<PlanResult<{ count: number }>> {
  await assertFeature("recurring_fees");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const p = z.object({ templateId: uuid, teamId: uuid, start: isoDate }).safeParse({ templateId, teamId, start });
  if (!p.success) return invalid(t);
  const db = await plansDb();
  const { data, error } = await db.rpc("recurring_enrol_team", { p_template: p.data.templateId, p_team: p.data.teamId, p_start: p.data.start });
  if (error) return fail(t, error);
  revalidatePath("/admin/recurring-fees");
  return { ok: true, message: t("plans.recurring.enrolled", { count: Number(data ?? 0) }), data: { count: Number(data ?? 0) } };
}

export async function endEnrolment(planId: string, end: string, why = ""): Promise<PlanResult> {
  await assertFeature("recurring_fees");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const p = z.object({ planId: uuid, end: isoDate }).safeParse({ planId, end });
  if (!p.success) return invalid(t);
  const db = await plansDb();
  const { error } = await db.rpc("recurring_end", { p_plan: p.data.planId, p_end: p.data.end, p_reason: why.trim().slice(0, 500) || null });
  if (error) return fail(t, error);
  revalidatePath(`/admin/payment-plans/${p.data.planId}`);
  revalidatePlans();
  return { ok: true, message: t("plans.recurring.ended") };
}

export async function addPause(planId: string, from: string, to: string, kind: "holiday" | "injury" | "other", note = ""): Promise<PlanResult> {
  await assertFeature("recurring_fees");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const p = z.object({ planId: uuid, from: isoDate, to: isoDate, kind: z.enum(["holiday", "injury", "other"]), note: z.string().trim().max(300) })
    .refine((v) => v.to >= v.from).safeParse({ planId, from, to, kind, note });
  if (!p.success) return invalid(t);
  const db = await plansDb();
  const { error } = await db.rpc("recurring_add_pause", { p_plan: p.data.planId, p_from: p.data.from, p_to: p.data.to, p_kind: p.data.kind, p_note: p.data.note || null });
  if (error) return fail(t, error);
  revalidatePath(`/admin/payment-plans/${p.data.planId}`);
  revalidatePlans();
  return { ok: true, message: t("plans.recurring.pauseAdded") };
}

export async function removePause(pauseId: string, planId: string): Promise<PlanResult> {
  await assertFeature("recurring_fees");
  const { me, t } = await staff();
  if (!me) return denied(t);
  if (!uuid.safeParse(pauseId).success || !uuid.safeParse(planId).success) return invalid(t);
  const db = await plansDb();
  const { error } = await db.rpc("recurring_remove_pause", { p_pause: pauseId });
  if (error) return fail(t, error);
  revalidatePath(`/admin/payment-plans/${planId}`);
  revalidatePlans();
  return { ok: true, message: t("plans.recurring.pauseRemoved") };
}

export async function skipPeriod(planId: string, periodStart: string, why: string): Promise<PlanResult> {
  await assertFeature("recurring_fees");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const p = z.object({ planId: uuid, periodStart: isoDate }).safeParse({ planId, periodStart });
  const r = reason.safeParse(why);
  if (!p.success) return invalid(t);
  if (!r.success) return fail(t, "REASON_REQUIRED");
  const db = await plansDb();
  const { error } = await db.rpc("recurring_skip_period", { p_plan: p.data.planId, p_period_start: p.data.periodStart, p_reason: r.data });
  if (error) return fail(t, error);
  revalidatePath(`/admin/payment-plans/${p.data.planId}`);
  revalidatePlans();
  return { ok: true, message: t("plans.recurring.skipped") };
}

/**
 * "Run now": issue every period invoice due up to `asOf` (at most 31 days
 * ahead), then the rest of the daily job for this club (reminders, autopay
 * for instalments already due today). Same idempotent code as the cron.
 */
export async function runRecurringNow(asOf: string): Promise<PlanResult<{ invoices: number }>> {
  await assertFeature("recurring_fees");
  const { me, t } = await staff();
  if (!me) return denied(t);
  const d = isoDate.safeParse(asOf);
  if (!d.success) return invalid(t);
  const today = await clubToday(me.orgId);
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + 31 * 864e5).toISOString().slice(0, 10);
  if (d.data > limit) return fail(t, "INVALID_DATE");
  const db = await plansDb();
  // Authorisation through the session first (finance of this org), then the service-role job.
  const { error } = await db.rpc("recurring_generate", { p_org: me.orgId, p_as_of: d.data, p_dry_run: true });
  if (error) return fail(t, error);
  const sum = await runOrgBilling(me.orgId, { generateUntil: d.data });
  revalidatePlans();
  revalidatePath("/admin/invoices");
  return { ok: true, message: t("plans.recurring.ran", { count: sum.invoices }), data: { invoices: sum.invoices } };
}

/** Finance: retry a failed / fallen-back autopay charge now. */
export async function retryCharge(installmentId: string): Promise<PlanResult> {
  await assertFeature("payment_plans");
  const { me, t } = await staff();
  if (!me) return denied(t);
  if (!uuid.safeParse(installmentId).success) return invalid(t);
  const db = await plansDb();
  const { error } = await db.rpc("autopay_retry_now", { p_installment: installmentId });
  if (error) return fail(t, error);
  const outcome = await chargeInstalmentNow(me.orgId, installmentId);
  revalidatePlans();
  return { ok: true, message: t.dynamic(`plans.autopay.retryOutcome.${outcome}`, undefined, t("plans.autopay.retryOutcome.queued")) };
}

// ===========================================================================
// Autopay (parent: own family only)
// ===========================================================================
async function myFamilies(me: SessionUser & { orgId: string }): Promise<string[]> {
  const db = await plansDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", me.id);
  const ids = (links ?? []).map((l) => l.family_id);
  if (!ids.length) return [];
  const { data: fams } = await db.from("families").select("id").eq("org_id", me.orgId).in("id", ids);
  return (fams ?? []).map((f) => f.id);
}

export async function startAutopaySetup(familyId: string, accepted: boolean): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await assertFeature("payment_plans");
  const { me, t } = await member();
  if (!me) return denied(t);
  if (!uuid.safeParse(familyId).success) return invalid(t);
  if (!accepted) return fail(t, "CONSENT_REQUIRED");
  if (!(await myFamilies(me)).includes(familyId)) return fail(t, "FAMILY_NOT_FOUND");
  const settings = await loadPlanSettings(me.orgId);
  if (!settings.autopayEnabled) return fail(t, "AUTOPAY_DISABLED");
  const profile = await getOrgPaymentProfile(me.orgId);
  if (!getStripe() || !profile.stripeReady) return fail(t, "ONLINE_UNAVAILABLE");

  // The exact wording the parent accepted, in their language, with the version.
  const consent = t("plans.autopay.consentText", { club: profile.name });
  const db = await plansDb();
  const { data, error } = await db.rpc("autopay_start_setup", { p_family: familyId, p_consent_version: settings.mandateVersion, p_consent_text: consent });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { mandate_id?: string; customer_id?: string | null };
  if (!r.mandate_id) return fail(t, "generic");
  try {
    const url = await createAutopaySetupSession({
      profile, mandateId: r.mandate_id, familyId, customerId: r.customer_id ?? null, email: me.email, returnPath: "/parent/payment-plans",
    });
    return { ok: true, url };
  } catch (e) {
    logError("plans.autopaySetup", e);
    return fail(t, "ONLINE_UNAVAILABLE");
  }
}

export async function setAutopayEnabled(mandateId: string, enabled: boolean): Promise<PlanResult> {
  await assertFeature("payment_plans");
  const { me, t } = await member();
  if (!me) return denied(t);
  if (!uuid.safeParse(mandateId).success) return invalid(t);
  const db = await plansDb();
  const { error } = await db.rpc("autopay_set_enabled", { p_mandate: mandateId, p_enabled: Boolean(enabled) });
  if (error) return fail(t, error);
  revalidatePlans();
  return { ok: true, message: t(enabled ? "plans.autopay.turnedOn" : "plans.autopay.turnedOff") };
}

export async function removeCard(mandateId: string): Promise<PlanResult> {
  await assertFeature("payment_plans");
  const { me, t } = await member();
  if (!me) return denied(t);
  if (!uuid.safeParse(mandateId).success) return invalid(t);
  const db = await plansDb();
  const { data, error } = await db.rpc("autopay_revoke", { p_mandate: mandateId });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { org_id?: string; payment_method?: string | null };
  if (r.org_id && r.payment_method) await detachPaymentMethod(await getOrgPaymentProfile(r.org_id), r.payment_method);
  revalidatePlans();
  return { ok: true, message: t("plans.autopay.removed") };
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { revalidateMoney } from "@/lib/money/action-helpers";
import { PAYER_KINDS, SELECTABLE_CATEGORIES, billingErrorCode } from "@/lib/billing/activities";

/*
 * Billing foundation — server actions (migration 20250420103500). The org is
 * always the caller's (session); every RPC re-checks role and org in SQL:
 *   admin    billing entities + routing, membership issue / carry-forward,
 *            club season settings, seasons, invoice reclassification
 *   finance  (admin or finance) receipts and allocations, membership preview,
 *            credit pools, review flags
 * Coaches and parents can call none of these. Writes that must not happen
 * twice take a client-generated requestId (uuid); a retry with the same id
 * returns the original result (`replayed: true`). Errors come back as a
 * translated message plus the SQL error code (billing.errors.<CODE>).
 * Contract: docs/billing-foundation.md.
 */
export type BillingResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; code?: string };

type Me = SessionUser & { orgId: string };
type Role = "admin" | "finance";

async function session(roles: Role[]): Promise<{ me: Me | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return { me: null, t };
  return { me: me as Me, t };
}

function fail(t: Translator, error: { message?: string; code?: string } | string | null | undefined): { ok: false; error: string; code?: string } {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = billingErrorCode(msg);
  if (code) return { ok: false, code, error: t.dynamic(`billing.errors.${code}`, undefined, t("billing.errors.generic")) };
  if (typeof error !== "string" && error?.code === "23505") return { ok: false, code: "DUPLICATE", error: t("billing.errors.DUPLICATE") };
  if (msg) logError("billing", msg);
  return { ok: false, error: t("billing.errors.generic") };
}
const denied = (t: Translator) => ({ ok: false as const, code: "NOT_AUTHORIZED", error: t("billing.errors.NOT_AUTHORIZED") });
const invalid = (t: Translator) => ({ ok: false as const, code: "INVALID_INPUT", error: t("billing.errors.invalid") });

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().nonnegative().max(1_000_000);
/** A revenue category a user may choose ("other" is legacy only). */
const activity = z.enum(SELECTABLE_CATEGORIES);
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const offlineMethod = z.enum(["manual", "bank_transfer", "twint", "qr_bill", "card"]);

function revalidateBilling(invoiceIds: (string | null | undefined)[] = []) {
  revalidatePath("/admin/settings/billing-entities");
  revalidatePath("/admin/settings/seasons");
  revalidatePath("/admin/memberships");
  revalidatePath("/admin/families", "layout");
  revalidatePath("/admin/athletes", "layout");
  revalidatePath("/parent/invoices");
  revalidateMoney(invoiceIds);
}

// ===========================================================================
// Billing entities + routing (admin)
// ===========================================================================
const entitySchema = z.object({
  id: uuid.optional().nullable(),
  name: z.string().trim().min(1).max(140),
  legalName: optText(140),
  street: optText(70),
  buildingNumber: optText(16),
  addressExtra: optText(140),
  postalCode: optText(16),
  city: optText(35),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("CH"),
  vatNumber: optText(40),
  iban: optText(40),
  qrIban: optText(40),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
  phone: optText(40),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type BillingEntityInput = z.input<typeof entitySchema>;

/** Create or update (full replace of the fields) a billing entity. */
export async function saveBillingEntity(input: BillingEntityInput): Promise<BillingResult<{ id: string }>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = entitySchema.safeParse(input);
  if (!p.success) return invalid(t);
  const v = p.data;
  const db = await createClient();
  const { data, error } = await db.rpc("billing_entity_save", {
    p_payload: {
      id: v.id ?? null, name: v.name, legal_name: v.legalName, street: v.street, building_number: v.buildingNumber,
      address_extra: v.addressExtra, postal_code: v.postalCode, city: v.city, country: v.country, vat_number: v.vatNumber,
      iban: v.iban, qr_iban: v.qrIban, email: v.email, phone: v.phone, is_default: v.isDefault, is_active: v.isActive,
    } as Json,
  });
  if (error) return fail(t, error);
  revalidateBilling();
  return { ok: true, message: t("billing.saved"), data: { id: String((data as { id?: string } | null)?.id ?? "") } };
}

/** Route an activity to an entity; entityId null = back to the default entity. */
export async function setBillingEntityRoute(input: { activity: string; entityId: string | null }): Promise<BillingResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({ activity, entityId: uuid.nullable() }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("billing_entity_route_set", { p_activity: p.data.activity, p_entity: p.data.entityId });
  if (error) return fail(t, error);
  revalidateBilling();
  return { ok: true, message: t("billing.saved") };
}

/**
 * Invoice number prefix of a revenue category (admin). Numbers become
 * "<prefix>-<YYYY>-<NNNN>" for invoices issued from now on; an empty prefix
 * removes the series (the club's invoice pattern applies again). Issued
 * numbers never change.
 */
export async function setInvoiceNumberPrefix(input: { category: string; prefix: string | null; isActive?: boolean }): Promise<BillingResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({
    category: z.enum(SELECTABLE_CATEGORIES), prefix: z.string().trim().max(24).nullable(), isActive: z.boolean().default(true),
  }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("invoice_number_series_set", {
    p_category: p.data.category, p_prefix: p.data.prefix ?? "", p_is_active: p.data.isActive,
  });
  if (error) return fail(t, error);
  revalidateBilling();
  return { ok: true, message: t("billing.saved") };
}

/** Correct the issuing entity of a DRAFT invoice (admin). */
export async function setInvoiceBillingEntity(input: { invoiceId: string; entityId: string }): Promise<BillingResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({ invoiceId: uuid, entityId: uuid }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("invoice_set_billing_entity", { p_invoice: p.data.invoiceId, p_entity: p.data.entityId });
  if (error) return fail(t, error);
  revalidateBilling([p.data.invoiceId]);
  return { ok: true, message: t("billing.saved") };
}

/** Reclassify an invoice (admin; drafts or invoices the migration could only default). */
export async function setInvoiceActivity(input: { invoiceId: string; activity: string; reason: string }): Promise<BillingResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({ invoiceId: uuid, activity, reason: z.string().trim().min(1).max(500) }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("invoice_set_activity", { p_invoice: p.data.invoiceId, p_activity: p.data.activity, p_reason: p.data.reason });
  if (error) return fail(t, error);
  revalidateBilling([p.data.invoiceId]);
  return { ok: true, message: t("billing.saved") };
}

// ===========================================================================
// Club season settings + seasons (admin)
// ===========================================================================
const settingsSchema = z.object({
  seasonStartMonth: z.number().int().min(1).max(12),
  installmentCount: z.number().int().min(1).max(12),
  installmentDueDay: z.number().int().min(1).max(31),
  /** null = the season start month. */
  firstInstallmentMonth: z.number().int().min(1).max(12).nullable(),
});
export type ClubBillingSettingsInput = z.input<typeof settingsSchema>;

export async function saveClubBillingSettings(input: ClubBillingSettingsInput): Promise<BillingResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = settingsSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("club_billing_settings_set", {
    p_payload: {
      season_start_month: p.data.seasonStartMonth, installment_count: p.data.installmentCount,
      installment_due_day: p.data.installmentDueDay, first_installment_month: p.data.firstInstallmentMonth,
    } as Json,
  });
  if (error) return fail(t, error);
  revalidateBilling();
  return { ok: true, message: t("billing.saved") };
}

const seasonSchema = z.object({
  id: uuid.optional().nullable(),
  name: z.string().trim().min(1).max(80),
  startsOn: isoDate,
  endsOn: isoDate,
}).refine((s) => s.endsOn >= s.startsOn, { path: ["endsOn"] });
export type SeasonInput = z.input<typeof seasonSchema>;

/** Create or update a season (name and dates). Season dates of season-fee memberships follow. */
export async function saveSeason(input: SeasonInput): Promise<BillingResult<{ id: string }>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = seasonSchema.safeParse(input);
  if (!p.success) return { ok: false, code: "SEASON_DATES_INVALID", error: t("billing.errors.SEASON_DATES_INVALID") };
  const db = await createClient();
  const row = { name: p.data.name, starts_on: p.data.startsOn, ends_on: p.data.endsOn };
  const res = p.data.id
    ? await db.from("seasons").update(row).eq("id", p.data.id).eq("org_id", me.orgId).select("id").maybeSingle()
    : await db.from("seasons").insert({ ...row, org_id: me.orgId }).select("id").single();
  if (res.error) return fail(t, res.error);
  if (!res.data) return { ok: false, code: "SEASON_NOT_FOUND", error: t("billing.errors.SEASON_NOT_FOUND") };
  revalidateBilling();
  return { ok: true, message: t("billing.saved"), data: { id: res.data.id } };
}

export async function setCurrentSeason(seasonId: string): Promise<BillingResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuid.safeParse(seasonId).success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("season_set_current", { p_season: seasonId });
  if (error) return fail(t, error);
  revalidateBilling();
  return { ok: true, message: t("billing.saved") };
}

// ===========================================================================
// Season memberships: preview (finance), issue + carry-forward (admin)
// ===========================================================================
const payerSchema = z.object({
  kind: z.enum(PAYER_KINDS),
  profileId: uuid.optional().nullable(),
  familyId: uuid.optional().nullable(),
  name: optText(140),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
  shareKind: z.enum(["fixed", "percent"]),
  shareValue: z.number().finite().positive().max(1_000_000),
});
const membershipSchema = z.object({
  athleteId: uuid,
  seasonId: uuid,
  agreedFee: money,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().nullable(),
  installmentCount: z.number().int().min(1).max(24).optional().nullable(),
  /** Any date in the first instalment month (YYYY-MM-DD). */
  firstDueMonth: isoDate.optional().nullable(),
  dueDay: z.number().int().min(1).max(31).optional().nullable(),
  payers: z.array(payerSchema).max(10),
  sponsored: z.boolean().optional(),
  sponsoredNotes: optText(1000),
  /** Invoice description / line label (translated by the caller); default: the season name. */
  description: optText(500),
});
export type MembershipInput = z.input<typeof membershipSchema>;

function membershipPayload(v: z.output<typeof membershipSchema>): Record<string, unknown> {
  return {
    athlete_id: v.athleteId, season_id: v.seasonId, agreed_fee: v.agreedFee, currency: v.currency ?? null,
    installment_count: v.installmentCount ?? null, first_due_month: v.firstDueMonth ?? null, due_day: v.dueDay ?? null,
    sponsored: v.sponsored ?? false, sponsored_notes: v.sponsoredNotes, description: v.description,
    payers: v.payers.map((p) => ({
      kind: p.kind, profile_id: p.profileId ?? null, family_id: p.familyId ?? null, name: p.name, email: p.email,
      share_kind: p.shareKind, share_value: p.shareValue,
    })),
  };
}

export type MembershipPreview = {
  athlete_id: string; family_id: string; currency: string; agreed_fee: number; installment_count: number; first_due_month: string;
  due_day: number; sponsored: boolean; existing_membership_id: string | null; months_without_installment: string[];
  season: { id: string; name: string; starts_on: string; ends_on: string };
  payers: {
    index: number; kind: string; profile_id: string | null; family_id: string | null; name: string | null; email: string | null;
    share_kind: "fixed" | "percent"; share_value: number; amount: number; schedule: { seq: number; due_on: string; amount: number }[];
  }[];
};

/** Payer amounts and instalment schedules, without writing anything. */
export async function previewMembership(input: MembershipInput): Promise<BillingResult<MembershipPreview>> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const p = membershipSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("membership_preview", { p_payload: membershipPayload(p.data) as Json });
  if (error) return fail(t, error);
  return { ok: true, data: data as unknown as MembershipPreview };
}

export type MembershipIssueResult = {
  membership_id: string; season_id: string; athlete_id: string; agreed_fee: number; currency: string; replayed: boolean;
  invoices: { payer_id: string; payer_index: number; payer_kind: string; invoice_id: string | null; number: string | null; amount: number; plan_id: string | null }[];
};

/** Membership + one invoice (and instalment plan) per payer, in one transaction. Idempotent by requestId. */
export async function issueMembership(input: MembershipInput & { requestId: string }): Promise<BillingResult<MembershipIssueResult>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = membershipSchema.extend({ requestId: uuid }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("membership_issue", {
    p_payload: { ...membershipPayload(p.data), request_id: p.data.requestId } as Json,
  });
  if (error) return fail(t, error);
  const res = data as unknown as MembershipIssueResult;
  revalidateBilling(res.invoices.map((i) => i.invoice_id));
  revalidatePath(`/admin/athletes/${p.data.athleteId}`);
  return { ok: true, message: t("billing.membership.issued"), data: res };
}

/** Separate club_membership invoice on a later season (charge_kind carry_forward). */
export async function carryForwardMembership(input: {
  fromMembershipId: string; toMembershipId: string; amount: number; reason: string; requestId: string;
}): Promise<BillingResult<{ invoice_id: string; number: string; amount: number; replayed: boolean }>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({
    fromMembershipId: uuid, toMembershipId: uuid, amount: money.positive(), reason: z.string().trim().min(1).max(500), requestId: uuid,
  }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("membership_carry_forward", {
    p_from: p.data.fromMembershipId, p_to: p.data.toMembershipId, p_amount: p.data.amount, p_reason: p.data.reason,
    p_request_id: p.data.requestId,
  });
  if (error) return fail(t, error);
  const res = data as unknown as { invoice_id: string; number: string; amount: number; replayed: boolean };
  revalidateBilling([res.invoice_id]);
  return { ok: true, message: t("billing.saved"), data: res };
}

// ===========================================================================
// Receipts (admin / finance)
// ===========================================================================
const allocationSchema = z.object({ invoiceId: uuid, amount: money.positive(), installmentId: uuid.optional().nullable() });
const allocationsJson = (a: z.output<typeof allocationSchema>[]) =>
  a.map((x) => ({ invoice_id: x.invoiceId, amount: x.amount, installment_id: x.installmentId ?? null }));

export type ReceiptSummary = {
  receipt_id: string; status: string; amount: number; currency: string; allocated: number; unallocated: number; received_on: string;
  method: string; family_id: string | null; bank_entry_id: string | null; request_id: string; replayed: boolean;
  allocations: { payment_id: string; invoice_id: string; invoice_number: string; activity: string; amount: number; installment_id: string | null; voided: boolean }[];
};

const receiptSchema = z.object({
  requestId: uuid,
  familyId: uuid.optional().nullable(),
  payerName: optText(140),
  amount: money.positive(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().nullable(),
  receivedOn: isoDate.optional().nullable(),
  method: offlineMethod.default("bank_transfer"),
  reference: optText(140),
  note: optText(1000),
  bankEntryId: uuid.optional().nullable(),
  allocations: z.array(allocationSchema).max(100).default([]),
});
export type ReceiptInput = z.input<typeof receiptSchema>;

/** Record one transfer and allocate it (one payment per invoice); the rest stays unallocated. */
export async function recordReceipt(input: ReceiptInput): Promise<BillingResult<ReceiptSummary>> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const p = receiptSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const v = p.data;
  const db = await createClient();
  const { data, error } = await db.rpc("receipt_record", {
    p_payload: {
      request_id: v.requestId, family_id: v.familyId ?? null, payer_name: v.payerName, amount: v.amount, currency: v.currency ?? null,
      received_on: v.receivedOn ?? null, method: v.method, reference: v.reference, note: v.note, bank_entry_id: v.bankEntryId ?? null,
      allocations: allocationsJson(v.allocations),
    } as Json,
  });
  if (error) return fail(t, error);
  const res = data as unknown as ReceiptSummary;
  revalidateBilling(v.allocations.map((a) => a.invoiceId));
  if (v.bankEntryId) revalidatePath("/admin/accounting", "layout");
  return { ok: true, message: t("billing.receipts.recorded"), data: res };
}

/** Allocate (more of) a receipt; requestId makes a retry book nothing twice. */
export async function allocateReceipt(input: {
  receiptId: string; requestId: string; allocations: z.input<typeof allocationSchema>[];
}): Promise<BillingResult<ReceiptSummary>> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const p = z.object({ receiptId: uuid, requestId: uuid, allocations: z.array(allocationSchema).min(1).max(100) }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("receipt_allocate", {
    p_receipt: p.data.receiptId, p_allocations: allocationsJson(p.data.allocations) as Json, p_request_id: p.data.requestId,
  });
  if (error) return fail(t, error);
  revalidateBilling(p.data.allocations.map((a) => a.invoiceId));
  return { ok: true, message: t("billing.receipts.allocated"), data: data as unknown as ReceiptSummary };
}

/** Void a receipt that has nothing allocated (entered twice, wrong amount). */
export async function voidReceipt(input: { receiptId: string; reason: string }): Promise<BillingResult> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const p = z.object({ receiptId: uuid, reason: z.string().trim().min(1).max(500) }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("receipt_void", { p_receipt: p.data.receiptId, p_reason: p.data.reason });
  if (error) return fail(t, error);
  revalidateBilling();
  return { ok: true, message: t("billing.saved") };
}

/*
 * Reversing an allocation uses the existing payment void (voidPayment in
 * src/lib/actions/invoice-edit.ts -> public.void_payment): the reversal row
 * carries the receipt, so the money is unallocated on the receipt again.
 */

// ===========================================================================
// Credit pools (admin / finance)
// ===========================================================================
/** Manual credit scoped to an activity (positive adds, negative removes). */
export async function adjustActivityCredit(input: {
  familyId: string; currency: string; amount: number; reason: string; activity: string;
}): Promise<BillingResult> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const p = z.object({
    familyId: uuid, currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/), amount: z.number().finite().refine((n) => n !== 0),
    reason: z.string().trim().min(1).max(500), activity,
  }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("adjust_family_credit", {
    p_family: p.data.familyId, p_currency: p.data.currency, p_amount: p.data.amount, p_reason: p.data.reason, p_activity: p.data.activity,
  });
  if (error) return fail(t, error);
  revalidateBilling();
  return { ok: true, message: t("billing.saved") };
}

/** Move unassigned (legacy) credit into one activity's pool. */
export async function assignCreditActivity(input: {
  familyId: string; currency: string; activity: string; amount: number; reason: string;
}): Promise<BillingResult> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const p = z.object({
    familyId: uuid, currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/), activity, amount: money.positive(),
    reason: z.string().trim().min(1).max(500),
  }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("family_credit_assign_activity", {
    p_family: p.data.familyId, p_currency: p.data.currency, p_activity: p.data.activity, p_amount: p.data.amount, p_reason: p.data.reason,
  });
  if (error) return fail(t, error);
  revalidateBilling();
  return { ok: true, message: t("billing.saved") };
}

// ===========================================================================
// Review flags (admin / finance)
// ===========================================================================
export async function resolveReviewFlag(input: { flagId: string; note?: string | null }): Promise<BillingResult> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const p = z.object({ flagId: uuid, note: optText(1000) }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("data_review_flag_resolve", { p_flag: p.data.flagId, p_note: p.data.note });
  if (error) return fail(t, error);
  revalidateBilling();
  return { ok: true, message: t("billing.saved") };
}

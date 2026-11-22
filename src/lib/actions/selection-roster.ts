"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { requireFeature } from "@/lib/upgrades/server";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { selectionDb } from "@/lib/selection/db";
import { moneyErrorCode, revalidateMoney } from "@/lib/money/action-helpers";
import { notifySelection } from "@/lib/selection/notify";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import { athleteSchema, familySchema } from "@/lib/people/validation";

/*
 * Selection roster — server actions (migration 20250420102900). The org is
 * always the caller's (session); every RPC re-checks role and org in SQL:
 * admin edits enrolments, finance (admin / finance) fee arrangements and
 * payments. Errors map SQL codes to translated, actionable messages; the
 * client keeps what was typed.
 */
export type RosterResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string; code?: string };

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const FEATURE = "selection_programs";

/** SQL error codes with a message under roster.errors.* (checked before the selection / money catalogs). */
const ROSTER_CODES = [
  "ALREADY_ENROLLED", "TOURNAMENT_COUNT_MISMATCH", "TOURNAMENT_NOT_FOUND", "TOURNAMENT_DIVISION_MISMATCH", "DUPLICATE_TOURNAMENT",
  "AGE_GROUP_MISMATCH", "FEE_REASON_REQUIRED", "FEE_CONFIRMATION_REQUIRED", "TOO_MANY_INSTALLMENTS", "INVALID_MONTHLY_AMOUNT",
  "INVALID_ARRANGEMENT", "ARRANGEMENT_LOCKED", "MOVE_HAS_PAYMENTS", "SAME_PROGRAM", "PROGRAM_NOT_FOUND", "ENROLLMENT_WITHDRAWN",
  "JERSEY_TAKEN", "NO_TEAM_FOR_JERSEY", "NOT_ON_TEAM", "INVALID_JERSEY", "USE_WITHDRAW", "PERIOD_CLOSED", "REASON_REQUIRED",
  "NOT_ACCEPTED", "PACKAGE_REQUIRED", "DIVISION_REQUIRED", "DIVISION_NOT_FOUND", "INVALID_TRANSITION", "APPLICATION_NOT_FOUND",
  "ATHLETE_NOT_FOUND", "NOT_AUTHORIZED", "NO_INVOICE", "SCHEDULE_PAST_PAYMENT_END",
] as const;

function fail(t: Translator, error: { message?: string; code?: string } | string | null | undefined): { ok: false; error: string; code?: string } {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = ROSTER_CODES.find((c) => new RegExp(`\\b${c}\\b`).test(msg));
  if (code) return { ok: false, code, error: t.dynamic(`roster.errors.${code}`, undefined, t("roster.errors.generic")) };
  const money = moneyErrorCode(msg);
  if (money) return { ok: false, code: money, error: t.dynamic(`editMoney.errors.${money}`, undefined, t("roster.errors.generic")) };
  if (typeof error !== "string" && error?.code === "23505") return { ok: false, code: "DUPLICATE", error: t("roster.errors.DUPLICATE") };
  if (msg) logError("selection.roster", msg);
  return { ok: false, error: t("roster.errors.generic") };
}

type Me = SessionUser & { orgId: string };
async function session(roles: ("admin" | "finance")[]): Promise<{ me: Me | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return { me: null, t };
  await requireFeature(me.orgId, FEATURE);
  return { me: me as Me, t };
}
const denied = (t: Translator) => ({ ok: false as const, code: "NOT_AUTHORIZED", error: t("roster.errors.NOT_AUTHORIZED") });
const invalid = (t: Translator) => ({ ok: false as const, error: t("roster.errors.invalid") });

/** Everything that shows roster, enrolment or programme money. */
function revalidateRoster(programIds: (string | null | undefined)[], athleteId?: string | null, invoiceIds: (string | null | undefined)[] = []) {
  revalidatePath("/admin/selection");
  revalidatePath("/admin/selection/report");
  revalidatePath("/admin/dashboard");
  revalidatePath("/coach/selection");
  revalidatePath("/parent/programmes");
  revalidatePath("/admin/finance");
  // Division teams (roster, jersey numbers) and programme lists / counts.
  revalidatePath("/admin/teams", "layout");
  revalidatePath("/coach/teams", "layout");
  revalidatePath("/admin/programs");
  for (const id of programIds) {
    if (!id) continue;
    revalidatePath(`/admin/selection/${id}`, "layout");
    revalidatePath(`/admin/programs/${id}`);
    revalidatePath(`/coach/selection/${id}`);
    revalidatePath(`/parent/programmes/${id}`);
  }
  if (athleteId) {
    revalidatePath(`/admin/athletes/${athleteId}`);
    revalidatePath(`/parent/children/${athleteId}`);
  }
  revalidateMoney(invoiceIds);
}

async function appOf(applicationId: string, orgId: string) {
  const db = await selectionDb();
  const { data } = await db.from("program_applications").select("id,program_id,athlete_id,invoice_id,status,family_id")
    .eq("id", applicationId).eq("org_id", orgId).maybeSingle();
  return data;
}

// ===========================================================================
// Athlete directory (admin): search, or create when not found
// ===========================================================================
export type DirectoryAthlete = {
  id: string; name: string; dob: string | null; familyName: string | null; licenceCategory: string | null; status: string;
  /** Live enrolments in the given programmes (shown as "already enrolled", never hidden). */
  enrolled: { applicationId: string; programId: string; divisionId: string | null; status: string }[];
};

export async function searchRosterAthletes(query: string, programIds: string[] = []): Promise<RosterResult<DirectoryAthlete[]>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const q = z.string().trim().min(1).max(80).safeParse(query);
  if (!q.success) return { ok: true, data: [] };
  const db = await createClient();
  let req = db.from("athletes").select("id,first_name,last_name,dob,status,licence_category,family_id,families(name)")
    .eq("org_id", me.orgId).neq("status", "archived");
  const year = /^\d{4}$/.test(q.data) ? Number(q.data) : null;
  if (year) {
    req = req.gte("dob", `${year}-01-01`).lte("dob", `${year}-12-31`);
  } else {
    const words = q.data.replace(/[%,()*]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3);
    for (const w of words) req = req.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`);
  }
  const { data, error } = await req.order("last_name").order("first_name").limit(20);
  if (error) return fail(t, error);
  type A = { id: string; first_name: string; last_name: string; dob: string | null; status: string; licence_category: string | null; families: { name: string } | { name: string }[] | null };
  const list = (data ?? []) as unknown as A[];
  const progs = programIds.filter((p) => uuid.safeParse(p).success).slice(0, 50);
  const live = new Map<string, DirectoryAthlete["enrolled"]>();
  if (list.length && progs.length) {
    const sdb = await selectionDb();
    const { data: apps } = await sdb.from("program_applications").select("id,athlete_id,program_id,division_id,status")
      .eq("org_id", me.orgId).in("program_id", progs).in("athlete_id", list.map((a) => a.id)).not("status", "in", "(declined,withdrawn)");
    for (const x of apps ?? []) {
      const arr = live.get(x.athlete_id) ?? [];
      arr.push({ applicationId: x.id, programId: x.program_id, divisionId: x.division_id, status: x.status });
      live.set(x.athlete_id, arr);
    }
  }
  return {
    ok: true,
    data: list.map((a) => ({
      id: a.id, name: `${a.first_name} ${a.last_name}`.trim(), dob: a.dob, status: a.status, licenceCategory: a.licence_category,
      familyName: Array.isArray(a.families) ? a.families[0]?.name ?? null : a.families?.name ?? null,
      enrolled: live.get(a.id) ?? [],
    })),
  };
}

const newAthleteSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dob: isoDate,
  familyId: z.union([z.literal(""), uuid]).optional().default(""),
  guardianName: z.string().trim().max(120).optional().default(""),
  guardianEmail: z.string().trim().max(200).optional().default(""),
  guardianPhone: z.string().trim().max(40).optional().default(""),
});
export type NewAthleteInput = z.input<typeof newAthleteSchema>;

/**
 * Create a minimal athlete (+ family with the guardian as billing contact
 * when no existing family is chosen). Admin only; same validation as the
 * people module. Use only when the directory search found nobody.
 */
export async function createRosterAthlete(input: NewAthleteInput): Promise<RosterResult<DirectoryAthlete>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = newAthleteSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const v = p.data;
  const db = await createClient();
  let familyId = v.familyId;
  let familyName: string | null = null;
  if (familyId) {
    const { data: fam } = await db.from("families").select("id,name").eq("id", familyId).eq("org_id", me.orgId).maybeSingle();
    if (!fam) return { ok: false, error: t("roster.errors.familyNotFound") };
    familyName = fam.name;
  } else {
    if (!v.guardianName) return { ok: false, error: t("roster.errors.guardianRequired") };
    const f = familySchema.safeParse({
      name: t("roster.add.familyName", { name: v.lastName }), contactName: v.guardianName,
      contactEmail: v.guardianEmail || null, phone: v.guardianPhone || null,
    });
    if (!f.success) return { ok: false, error: t("roster.errors.guardianEmail") };
    const { data: fam, error } = await db.from("families").insert({
      org_id: me.orgId, name: f.data.name, contact_name: f.data.contactName, contact_email: f.data.contactEmail, phone: f.data.phone,
    }).select("id,name").single();
    if (error || !fam) return fail(t, error);
    familyId = fam.id;
    familyName = fam.name;
  }
  const a = athleteSchema.safeParse({ familyId, firstName: v.firstName, lastName: v.lastName, dob: v.dob });
  if (!a.success) return invalid(t);
  const { data: ath, error } = await db.from("athletes").insert({
    org_id: me.orgId, family_id: a.data.familyId, first_name: a.data.firstName, last_name: a.data.lastName, dob: a.data.dob, status: "active",
  }).select("id,first_name,last_name,dob,status").single();
  if (error || !ath) return fail(t, error);
  revalidatePersonEverywhere(me.orgId);
  return { ok: true, data: { id: ath.id, name: `${ath.first_name} ${ath.last_name}`.trim(), dob: ath.dob, status: ath.status, familyName, licenceCategory: null, enrolled: [] } };
}

// ===========================================================================
// Enrolment form (add / edit)
// ===========================================================================
const money = z.coerce.number().finite().positive().max(1_000_000);
const optMoney = z.union([z.literal(""), z.null(), money]).optional().transform((v) => (v === "" || v == null ? null : v));
const reason = z.string().trim().max(500).optional().default("");

const enrollmentSchema = z.object({
  programId: uuid,
  divisionId: z.union([z.literal(""), uuid]).optional().default(""),
  packageId: uuid,
  tournamentIds: z.array(uuid).max(50).default([]),
  tournamentOverrideReason: reason,
  ageConfirmed: z.boolean().optional().default(false),
  kind: z.enum(["full", "monthly"]),
  fee: optMoney,
  feeReason: reason,
  feeConfirmed: z.boolean().optional().default(false),
  monthly: optMoney,
  firstDueOn: isoDate,
  status: z.enum(["accepted", "enrolled", "waitlisted"]).optional().default("enrolled"),
  jerseyNumber: z.union([z.literal(""), z.coerce.number().int().min(0).max(999)]).optional().default(""),
  staffNotes: z.string().trim().max(2000).optional().default(""),
});
export type EnrollmentInput = z.input<typeof enrollmentSchema>;

/** Add a player from the directory (admin): enrolment, tournaments and fee arrangement in one transaction. */
export async function addRosterPlayer(athleteId: string, input: EnrollmentInput): Promise<RosterResult<{ applicationId: string; programId: string }>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const a = uuid.safeParse(athleteId);
  const p = enrollmentSchema.safeParse(input);
  if (!a.success || !p.success) return invalid(t);
  const v = p.data;
  if (v.status === "waitlisted") return invalid(t);
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_staff_add", {
    p_program: v.programId, p_athlete: a.data, p_division: v.divisionId || null, p_package: v.packageId, p_tournaments: v.tournamentIds,
    p_kind: v.kind, p_monthly: v.kind === "monthly" ? v.monthly : null, p_first: v.firstDueOn, p_status: v.status,
    p_override_reason: v.tournamentOverrideReason || null, p_notes: v.staffNotes || null, p_fee: v.fee, p_fee_reason: v.feeReason || null,
    p_age_confirmed: v.ageConfirmed,
  });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { application_id?: string; invoice_id?: string; status?: string };
  if (r.application_id && v.jerseyNumber !== "") {
    const { error: jErr } = await db.rpc("selection_update_enrollment", { p_application: r.application_id, p_payload: { jersey_number: v.jerseyNumber } as unknown as Json });
    if (jErr) {
      revalidateRoster([v.programId], a.data, [r.invoice_id]);
      return { ok: false, error: `${t("roster.add.savedButJersey")} ${fail(t, jErr).error}` };
    }
  }
  if (r.application_id && r.status) await notifySelection(me.orgId, r.application_id, r.status === "enrolled" ? "enrolled" : "accepted");
  revalidateRoster([v.programId], a.data, [r.invoice_id]);
  return { ok: true, message: t("roster.form.saved"), data: { applicationId: r.application_id ?? "", programId: v.programId } };
}

/** Save an existing enrolment from the same form (admin), atomically in SQL. */
export async function saveRosterEnrollment(applicationId: string, input: EnrollmentInput): Promise<RosterResult<{ programId: string }>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const id = uuid.safeParse(applicationId);
  const p = enrollmentSchema.safeParse(input);
  if (!id.success || !p.success) return invalid(t);
  const v = p.data;
  const before = await appOf(id.data, me.orgId);
  if (!before) return { ok: false, error: t("roster.errors.APPLICATION_NOT_FOUND") };
  const payload = {
    program_id: v.programId, division_id: v.divisionId || null, package_id: v.packageId, tournaments: v.tournamentIds,
    tournament_override_reason: v.tournamentOverrideReason || null, age_confirmed: v.ageConfirmed, fee_confirmed: v.feeConfirmed,
    jersey_number: v.jerseyNumber === "" ? null : v.jerseyNumber, staff_notes: v.staffNotes, status: v.status,
    arrangement: { kind: v.kind, fee: v.fee, monthly: v.kind === "monthly" ? v.monthly : null, first_due_on: v.firstDueOn, reason: v.feeReason || null },
  };
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_save_enrollment", { p_application: id.data, p_payload: payload as unknown as Json });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { program_id?: string; invoice_id?: string; status?: string };
  if (r.status && r.status !== before.status && (r.status === "enrolled" || r.status === "accepted" || r.status === "waitlisted")) {
    await notifySelection(me.orgId, id.data, r.status);
  }
  revalidateRoster([before.program_id, r.program_id], before.athlete_id, [before.invoice_id, r.invoice_id]);
  return { ok: true, message: t("roster.form.saved"), data: { programId: r.program_id ?? before.program_id } };
}

const arrangementSchema = z.object({
  kind: z.enum(["full", "monthly"]),
  packageId: z.union([z.literal(""), uuid]).optional().default(""),
  fee: optMoney,
  monthly: optMoney,
  firstDueOn: isoDate,
  reason: reason,
});
export type ArrangementInput = z.input<typeof arrangementSchema>;

/** Fee arrangement only (finance and admin). After a payment: credit / debit note with the reason. */
export async function setRosterArrangement(applicationId: string, input: ArrangementInput): Promise<RosterResult> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const id = uuid.safeParse(applicationId);
  const p = arrangementSchema.safeParse(input);
  if (!id.success || !p.success) return invalid(t);
  const v = p.data;
  const before = await appOf(id.data, me.orgId);
  if (!before) return { ok: false, error: t("roster.errors.APPLICATION_NOT_FOUND") };
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_set_arrangement", {
    p_application: id.data, p_kind: v.kind, p_package: v.packageId || null, p_monthly: v.kind === "monthly" ? v.monthly : null,
    p_first: v.firstDueOn, p_reason: v.reason || null, p_fee: v.fee,
  });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { invoice_id?: string };
  revalidateRoster([before.program_id], before.athlete_id, [before.invoice_id, r.invoice_id]);
  return { ok: true, message: t("roster.arrangement.saved") };
}

// ===========================================================================
// Payments (finance and admin) — existing ledger RPCs
// ===========================================================================
const paymentSchema = z.object({
  amount: money,
  paidOn: isoDate,
  method: z.enum(["bank_transfer", "twint", "manual", "qr_bill", "card"]),
  reference: z.string().trim().max(200).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
});
export type RosterPaymentInput = z.input<typeof paymentSchema>;

export async function recordRosterPayment(applicationId: string, input: RosterPaymentInput): Promise<RosterResult> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const id = uuid.safeParse(applicationId);
  const p = paymentSchema.safeParse(input);
  if (!id.success) return invalid(t);
  if (!p.success) {
    const field = p.error.issues[0]?.path[0];
    return { ok: false, error: t(field === "amount" ? "editMoney.errors.INVALID_AMOUNT" : field === "paidOn" ? "editMoney.errors.INVALID_DATE" : "roster.errors.invalid") };
  }
  const app = await appOf(id.data, me.orgId);
  if (!app) return { ok: false, error: t("roster.errors.APPLICATION_NOT_FOUND") };
  if (!app.invoice_id) return { ok: false, error: t("roster.errors.NO_INVOICE") };
  const db = await createClient();
  const { error } = await db.rpc("record_offline_payment", {
    p_invoice: app.invoice_id, p_amount: p.data.amount, p_method: p.data.method, p_paid_on: p.data.paidOn,
    p_reference: p.data.reference || undefined, p_note: p.data.note || undefined,
  });
  if (error) return fail(t, error);
  revalidateRoster([app.program_id], app.athlete_id, [app.invoice_id]);
  return { ok: true, message: t("roster.payments.recorded") };
}

/** Reverse a recorded payment (existing void workflow: reversing row, history kept, reason required). */
export async function voidRosterPayment(applicationId: string, paymentId: string, why: string): Promise<RosterResult> {
  const { me, t } = await session(["admin", "finance"]);
  if (!me) return denied(t);
  const r = z.string().trim().min(1).max(500).safeParse(why);
  if (!uuid.safeParse(applicationId).success || !uuid.safeParse(paymentId).success) return invalid(t);
  if (!r.success) return { ok: false, error: t("roster.errors.REASON_REQUIRED") };
  const app = await appOf(applicationId, me.orgId);
  if (!app?.invoice_id) return { ok: false, error: t("roster.errors.APPLICATION_NOT_FOUND") };
  const db = await createClient();
  const { data: pay } = await db.from("payments").select("id").eq("id", paymentId).eq("invoice_id", app.invoice_id).maybeSingle();
  if (!pay) return { ok: false, error: t("editMoney.errors.PAYMENT_NOT_FOUND") };
  const { error } = await db.rpc("void_payment", { p_payment: paymentId, p_reason: r.data });
  if (error) return fail(t, error);
  revalidateRoster([app.program_id], app.athlete_id, [app.invoice_id]);
  return { ok: true, message: t("roster.payments.voided") };
}

// ===========================================================================
// Withdrawal (admin): keeps invoice, payments and plan
// ===========================================================================
export async function withdrawRosterEnrollment(applicationId: string, input: { reason: string; on?: string }): Promise<RosterResult<{ balance: number }>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({ reason: z.string().trim().min(1).max(500), on: z.union([z.literal(""), isoDate]).optional().default("") }).safeParse(input);
  if (!uuid.safeParse(applicationId).success) return invalid(t);
  if (!p.success) return { ok: false, error: t("roster.errors.REASON_REQUIRED") };
  const app = await appOf(applicationId, me.orgId);
  if (!app) return { ok: false, error: t("roster.errors.APPLICATION_NOT_FOUND") };
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_withdraw_enrollment", { p_application: applicationId, p_reason: p.data.reason, p_on: p.data.on || null });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { balance_at_withdrawal?: number | string };
  await notifySelection(me.orgId, applicationId, "withdrawn");
  revalidateRoster([app.program_id], app.athlete_id, [app.invoice_id]);
  return { ok: true, message: t("roster.withdraw.done"), data: { balance: Number(r.balance_at_withdrawal ?? 0) } };
}

export async function withdrawRosterTournament(applicationId: string, tournamentId: string, why: string): Promise<RosterResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuid.safeParse(applicationId).success || !uuid.safeParse(tournamentId).success) return invalid(t);
  const r = z.string().trim().min(1).max(500).safeParse(why);
  if (!r.success) return { ok: false, error: t("roster.errors.REASON_REQUIRED") };
  const app = await appOf(applicationId, me.orgId);
  if (!app) return { ok: false, error: t("roster.errors.APPLICATION_NOT_FOUND") };
  const db = await selectionDb();
  const { error } = await db.rpc("selection_withdraw_tournament", { p_application: applicationId, p_tournament: tournamentId, p_reason: r.data });
  if (error) return fail(t, error);
  revalidateRoster([app.program_id], app.athlete_id);
  return { ok: true, message: t("roster.withdraw.tournamentDone") };
}

/** Enrol an accepted player without waiting for a payment (admin, reason required; audited). */
export async function enrollRosterNow(applicationId: string, why: string): Promise<RosterResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuid.safeParse(applicationId).success) return invalid(t);
  const r = z.string().trim().min(1).max(500).safeParse(why);
  if (!r.success) return { ok: false, error: t("roster.errors.REASON_REQUIRED") };
  const app = await appOf(applicationId, me.orgId);
  if (!app) return { ok: false, error: t("roster.errors.APPLICATION_NOT_FOUND") };
  const db = await selectionDb();
  const { error } = await db.rpc("selection_enroll_now", { p_application: applicationId, p_reason: r.data });
  if (error) return fail(t, error);
  await notifySelection(me.orgId, applicationId, "enrolled");
  revalidateRoster([app.program_id], app.athlete_id, [app.invoice_id]);
  return { ok: true, message: t("roster.enrollNow.done") };
}

/** Re-run the programme registration of an enrolled player (health notice "fix"). */
export async function repairRosterRegistration(applicationId: string): Promise<RosterResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuid.safeParse(applicationId).success) return invalid(t);
  const app = await appOf(applicationId, me.orgId);
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_repair_registration", { p_application: applicationId });
  if (error) return fail(t, error);
  revalidateRoster([app?.program_id], app?.athlete_id);
  return data === true ? { ok: true, message: t("roster.health.repaired") } : { ok: false, error: t("roster.health.repairFailed") };
}

// ===========================================================================
// Tournament schedule (admin)
// ===========================================================================
const tournamentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  divisionId: z.union([z.literal(""), uuid]).optional().default(""),
  stage: z.string().trim().max(80).optional().default(""),
  city: z.string().trim().max(120).optional().default(""),
  location: z.string().trim().max(160).optional().default(""),
  startsOn: z.union([z.literal(""), isoDate]).optional().default(""),
  endsOn: z.union([z.literal(""), isoDate]).optional().default(""),
  sort: z.coerce.number().int().min(0).max(1000).optional().default(0),
  status: z.enum(["planned", "confirmed", "completed", "cancelled"]).optional().default("planned"),
}).refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, { message: "dates", path: ["endsOn"] });
export type TournamentInput = z.input<typeof tournamentSchema>;

export async function saveTournament(programId: string, tournamentId: string | null, input: TournamentInput): Promise<RosterResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuid.safeParse(programId).success || (tournamentId && !uuid.safeParse(tournamentId).success)) return invalid(t);
  const p = tournamentSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t(p.error.issues[0]?.message === "dates" ? "roster.errors.tournamentDates" : "roster.errors.tournamentName") };
  const v = p.data;
  const row = {
    name: v.name, division_id: v.divisionId || null, stage: v.stage || null, city: v.city || null, location: v.location || null,
    starts_on: v.startsOn || null, ends_on: v.endsOn || null, sort: v.sort, status: v.status,
  };
  const db = await selectionDb();
  const { data, error } = tournamentId
    ? await db.from("program_tournaments").update(row).eq("id", tournamentId).eq("program_id", programId).eq("org_id", me.orgId).select("id")
    : await db.from("program_tournaments").insert({ ...row, org_id: me.orgId, program_id: programId }).select("id");
  if (error) return error.code === "23505" ? { ok: false, error: t("roster.errors.tournamentDuplicate") } : fail(t, error);
  if (!data?.length) return denied(t);
  revalidateRoster([programId]);
  return { ok: true, message: t("roster.tournaments.saved") };
}

/** Delete a tournament nobody is enrolled in; otherwise mark it cancelled (history kept). */
export async function deleteTournament(programId: string, tournamentId: string): Promise<RosterResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuid.safeParse(programId).success || !uuid.safeParse(tournamentId).success) return invalid(t);
  const db = await selectionDb();
  const { count } = await db.from("application_tournaments").select("id", { count: "exact", head: true }).eq("tournament_id", tournamentId);
  const { error } = (count ?? 0) > 0
    ? await db.from("program_tournaments").update({ status: "cancelled" }).eq("id", tournamentId).eq("org_id", me.orgId)
    : await db.from("program_tournaments").delete().eq("id", tournamentId).eq("program_id", programId).eq("org_id", me.orgId);
  if (error) return fail(t, error);
  revalidateRoster([programId]);
  return { ok: true, message: t((count ?? 0) > 0 ? "roster.tournaments.cancelledInUse" : "roster.tournaments.deleted") };
}

/** Club setting: assigned coaches see the payment status badge on the roster (never amounts). */
export async function setCoachPaymentBadge(programId: string, on: boolean): Promise<RosterResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuid.safeParse(programId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.from("programs").update({ roster_coach_payment_status: !!on } as never).eq("id", programId).eq("org_id", me.orgId).select("id");
  if (error) return fail(t, error);
  if (!data?.length) return denied(t);
  revalidateRoster([programId]);
  return { ok: true, message: t("roster.settings.saved") };
}

/** Programme payment period (e.g. September - June): default first due date; no instalment after the end. */
export async function setPaymentPeriod(programId: string, startsOn: string | null, endsOn: string | null): Promise<RosterResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const optDate = isoDate.nullable();
  if (!uuid.safeParse(programId).success || !optDate.safeParse(startsOn).success || !optDate.safeParse(endsOn).success) return invalid(t);
  if (startsOn && endsOn && endsOn < startsOn) return { ok: false, error: t("roster.settings.paymentPeriodOrder") };
  const db = await createClient();
  const { data, error } = await db.from("programs").update({ payment_starts_on: startsOn, payment_ends_on: endsOn } as never)
    .eq("id", programId).eq("org_id", me.orgId).select("id");
  if (error) return fail(t, error);
  if (!data?.length) return denied(t);
  revalidateRoster([programId]);
  return { ok: true, message: t("roster.settings.saved") };
}

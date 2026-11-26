"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { requireFeature } from "@/lib/upgrades/server";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";
import { selectionAdminDb, selectionDb } from "@/lib/selection/db";
import { applicationExtrasSchema, decisionSchema, divisionSchema, packageSchema, settingsSchema, type DecisionInput, type DivisionInput, type PackageInput } from "@/lib/selection/rules";
import { notifySelection, notifyStaffNewApplication, type SelectionNoticeKind } from "@/lib/selection/notify";
import { getPublicSelection } from "@/lib/selection/data";
import { createGuestAccount, type GuestAccountChoice } from "@/lib/camps/checkout-helpers";
import { sportsDb } from "@/lib/sportsops/db";
import { confirmationMatches } from "@/lib/people/person-delete";
import { revalidateTeamsEverywhere } from "@/lib/people/revalidate";
import { teamErrorKey } from "@/lib/teams/team-delete";

/*
 * Selection programmes — server actions. The org always comes from the
 * session (profiles.org_id) or, on the public page, from the programme that
 * owns the slug. Every RPC re-checks the caller and the org in SQL
 * (SECURITY DEFINER); set-up tables are written under RLS (admins only).
 */
export type SelectionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string; errors?: Record<string, string> };

const uuid = z.string().uuid();
const FEATURE = "selection_programs";

/** Error codes raised in SQL with a translated message under selection.errors. */
const CODES = [
  "NOT_AUTHORIZED", "APPLICATION_NOT_FOUND", "PROGRAM_NOT_OPEN", "REGISTRATION_CLOSED", "ATHLETE_NOT_FOUND", "MEMBERS_ONLY",
  "DIVISION_NOT_FOUND", "DIVISION_REQUIRED", "PACKAGE_REQUIRED", "INVALID_VIDEO_URL", "ALREADY_APPLIED", "INVALID_TRANSITION",
  "NOTE_REQUIRED", "PACKAGE_LOCKED", "NOT_ACCEPTED", "COUNT_NOT_ALLOWED", "PLAN_EXISTS", "NOTHING_OUTSTANDING", "INVOICE_NOT_PAYABLE",
  "INVALID_EMAIL", "INVALID_CHILD", "VPC_REQUIRED", "CROSS_TENANT_REFERENCE",
] as const;

function fail(t: Translator, error: { message?: string } | string | null | undefined): { ok: false; error: string } {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = CODES.find((c) => new RegExp(`\\b${c}\\b`).test(msg));
  if (code) return { ok: false, error: t.dynamic(`selection.errors.${code}`, undefined, t("selection.errors.generic")) };
  if (/duplicate key|uq_program_(divisions|packages)/.test(msg)) return { ok: false, error: t("selection.errors.duplicateName") };
  if (msg) logError("selection.action", msg);
  return { ok: false, error: t("selection.errors.generic") };
}

function issues(t: Translator, err: z.ZodError): { ok: false; error: string; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  for (const i of err.issues) errors[i.path.join(".")] = t.dynamic(i.message, undefined, t("selection.errors.invalid"));
  return { ok: false, error: Object.values(errors)[0] ?? t("selection.errors.invalid"), errors };
}

type Me = SessionUser & { orgId: string };
async function session(roles?: ("admin" | "finance" | "coach" | "parent")[]): Promise<{ me: Me | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId) return { me: null, t };
  if (roles && !roles.some((r) => me.roles.includes(r))) return { me: null, t };
  await requireFeature(me.orgId, FEATURE);
  return { me: me as Me, t };
}

function revalidate(programId?: string | null) {
  revalidatePath("/admin/selection");
  revalidatePath("/admin/dashboard");
  revalidatePath("/coach/selection");
  revalidatePath("/parent/programmes");
  revalidatePath("/parent/invoices");
  if (programId) {
    revalidatePath(`/admin/selection/${programId}`);
    revalidatePath(`/coach/selection/${programId}`);
    revalidatePath(`/parent/programmes/${programId}`);
    revalidatePath(`/admin/programs/${programId}`);
  }
}

// ===========================================================================
// Set-up (admins)
// ===========================================================================
export async function saveSelectionSettings(programId: string, input: z.input<typeof settingsSchema>): Promise<SelectionResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  const id = uuid.safeParse(programId);
  const p = settingsSchema.safeParse(input);
  if (!id.success || !p.success) return { ok: false, error: t("selection.errors.invalid") };
  const db = await selectionDb();
  const { data, error } = await db.from("programs")
    .update({ selection_enabled: p.data.selectionEnabled, requires_approval: p.data.requiresApproval, allow_non_members: p.data.allowNonMembers })
    .eq("id", id.data).eq("org_id", me.orgId).select("id");
  if (error) return fail(t, error);
  if (!data?.length) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  revalidate(id.data);
  return { ok: true, message: t("selection.setup.saved") };
}

export async function saveDivision(programId: string, divisionId: string | null, input: DivisionInput | Record<string, unknown>): Promise<SelectionResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  const pid = uuid.safeParse(programId);
  if (!pid.success || (divisionId && !uuid.safeParse(divisionId).success)) return { ok: false, error: t("selection.errors.invalid") };
  const p = divisionSchema.safeParse(input);
  if (!p.success) return issues(t, p.error);
  const v = p.data;
  const createTeam = v.teamMode === "create";
  const row = {
    name: v.name, min_birth_year: v.minBirthYear, max_birth_year: v.maxBirthYear, age_under: v.ageUnder, age_cutoff: v.ageCutoff,
    // "create": the team is created and linked below, in SQL (create_division_team);
    // a team linked before is unlinked (kept, never deleted here).
    team_id: createTeam || v.teamMode === "none" ? null : v.teamId,
    capacity: v.capacity, sort: v.sort, is_active: v.isActive,
  };
  const db = await selectionDb();
  let id = divisionId;
  if (divisionId) {
    const { error } = await db.from("program_divisions").update(row).eq("id", divisionId).eq("program_id", pid.data).eq("org_id", me.orgId);
    if (error) return fail(t, error);
  } else {
    const { data, error } = await db.from("program_divisions").insert({ ...row, org_id: me.orgId, program_id: pid.data }).select("id").single();
    if (error) return fail(t, error);
    id = data.id;
  }
  if (createTeam && id) {
    // Team "<programme short name> <division>" (or the typed name): same sport,
    // age group, level, the programme's / current season. Org and admin role
    // are checked again in SQL.
    const { error } = await db.rpc("create_division_team", { p_division: id, p_name: v.teamName || null });
    if (error) {
      logError("selection.createDivisionTeam", error.message);
      revalidate(pid.data);
      return { ok: false, error: t.dynamic(teamErrorKey(error.message), undefined, t("selection.errors.generic")) };
    }
    revalidateTeamsEverywhere(me.orgId);
  }
  revalidate(pid.data);
  return { ok: true, message: t(createTeam ? "teamAdmin.division.teamCreated" : "selection.setup.saved") };
}

const deleteDivisionSchema = z.object({
  moveTo: z.union([z.literal(""), z.null(), uuid]).optional().transform((v) => (v ? v : null)),
  teamMode: z.enum(["keep", "archive", "delete"]).optional().default("keep"),
  confirmTeamName: z.string().max(300).optional(),
});

/**
 * Delete a division. Live applications (not declined / withdrawn) block it
 * unless `moveTo` names another division of the programme; the division's
 * team is kept, archived or deleted permanently (typed team name). One
 * transaction in SQL (selection_delete_division).
 */
export async function deleteDivision(programId: string, divisionId: string, opts: z.input<typeof deleteDivisionSchema> = {}): Promise<SelectionResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  const o = deleteDivisionSchema.safeParse(opts);
  if (!uuid.safeParse(programId).success || !uuid.safeParse(divisionId).success || !o.success) return { ok: false, error: t("selection.errors.invalid") };
  const db = await selectionDb();
  if (o.data.teamMode === "delete") {
    const { data: div } = await db.from("program_divisions").select("team_id").eq("id", divisionId).eq("org_id", me.orgId).maybeSingle();
    const { data: team } = div?.team_id
      ? await (await sportsDb()).from("teams").select("name").eq("id", div.team_id).eq("org_id", me.orgId).maybeSingle()
      : { data: null };
    if (team && !confirmationMatches(o.data.confirmTeamName ?? "", team.name)) return { ok: false, error: t("teamAdmin.errors.confirmMismatch") };
  }
  const { error } = await db.rpc("selection_delete_division", { p_division: divisionId, p_move_to: o.data.moveTo, p_team_mode: o.data.teamMode });
  if (error) {
    if (!/DIVISION_HAS_APPLICATIONS|TEAM_DELETE_BLOCKED|DIVISION_NOT_FOUND/.test(error.message)) logError("selection.deleteDivision", error.message);
    return { ok: false, error: t.dynamic(teamErrorKey(error.message), undefined, t("selection.errors.generic")) };
  }
  revalidate(programId);
  if (o.data.teamMode !== "keep") revalidateTeamsEverywhere(me.orgId);
  return { ok: true, message: t("selection.setup.deleted") };
}

export async function savePackage(programId: string, packageId: string | null, input: PackageInput | Record<string, unknown>): Promise<SelectionResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  const pid = uuid.safeParse(programId);
  if (!pid.success || (packageId && !uuid.safeParse(packageId).success)) return { ok: false, error: t("selection.errors.invalid") };
  const p = packageSchema.safeParse(input);
  if (!p.success) return issues(t, p.error);
  const v = p.data;
  const row = {
    name: v.name, description: v.description || null, price: v.price, allowed_counts: v.counts, show_monthly: v.showMonthly,
    sort: v.sort, is_active: v.isActive, tournament_count: v.tournamentCount, monthly_amount: v.monthlyAmount,
  };
  const db = await selectionDb();
  const { error } = packageId
    ? await db.from("program_packages").update(row).eq("id", packageId).eq("program_id", pid.data).eq("org_id", me.orgId)
    : await db.from("program_packages").insert({ ...row, org_id: me.orgId, program_id: pid.data });
  if (error) return fail(t, error);
  revalidate(pid.data);
  return { ok: true, message: t("selection.setup.saved") };
}

export async function deletePackage(programId: string, packageId: string): Promise<SelectionResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  if (!uuid.safeParse(programId).success || !uuid.safeParse(packageId).success) return { ok: false, error: t("selection.errors.invalid") };
  const db = await selectionDb();
  const { count } = await db.from("program_applications").select("id", { count: "exact", head: true }).eq("package_id", packageId).eq("org_id", me.orgId);
  const { error } = (count ?? 0) > 0
    ? await db.from("program_packages").update({ is_active: false }).eq("id", packageId).eq("org_id", me.orgId)
    : await db.from("program_packages").delete().eq("id", packageId).eq("program_id", programId).eq("org_id", me.orgId);
  if (error) return fail(t, error);
  revalidate(programId);
  return { ok: true, message: t((count ?? 0) > 0 ? "selection.setup.deactivated" : "selection.setup.deleted") };
}

const coachSchema = z.object({ coachId: uuid, divisionId: z.union([z.literal(""), uuid]).optional().default(""), role: z.enum(["head", "assistant"]) });

export async function assignCoach(programId: string, input: z.input<typeof coachSchema>): Promise<SelectionResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  const p = coachSchema.safeParse(input);
  if (!uuid.safeParse(programId).success || !p.success) return { ok: false, error: t("selection.errors.invalid") };
  const db = await selectionDb();
  const { error } = await db.from("program_coaches").insert({
    org_id: me.orgId, program_id: programId, coach_id: p.data.coachId, division_id: p.data.divisionId || null, role: p.data.role,
  });
  if (error) return fail(t, error);
  revalidate(programId);
  return { ok: true, message: t("selection.setup.saved") };
}

export async function removeCoach(programId: string, assignmentId: string): Promise<SelectionResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  if (!uuid.safeParse(programId).success || !uuid.safeParse(assignmentId).success) return { ok: false, error: t("selection.errors.invalid") };
  const db = await selectionDb();
  const { error } = await db.from("program_coaches").delete().eq("id", assignmentId).eq("program_id", programId).eq("org_id", me.orgId);
  if (error) return fail(t, error);
  revalidate(programId);
  return { ok: true, message: t("selection.setup.deleted") };
}

// ===========================================================================
// Review (admins and the programme's coaches)
// ===========================================================================
export async function decideApplication(applicationId: string, input: DecisionInput): Promise<SelectionResult> {
  const { me, t } = await session(["admin", "finance", "coach"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  const id = uuid.safeParse(applicationId);
  const p = decisionSchema.safeParse(input);
  if (!id.success) return { ok: false, error: t("selection.errors.invalid") };
  if (!p.success) return issues(t, p.error);
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_set_status", {
    p_application: id.data, p_status: p.data.status || null, p_note: p.data.note || null,
    p_division: p.data.divisionId || null, p_staff_notes: p.data.staffNotes ?? null,
  });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { status?: string; previous_status?: string; family_id?: string };
  const { data: app } = await db.from("program_applications").select("program_id").eq("id", id.data).maybeSingle();
  if (r.status && r.status !== r.previous_status) await notifySelection(me.orgId, id.data, r.status as SelectionNoticeKind);
  revalidate(app?.program_id);
  return { ok: true, message: t("selection.review.saved") };
}

const sponsorSchema = z.object({
  kind: z.enum(["none", "full", "partial"]),
  percent: z.union([z.literal(""), z.coerce.number().min(1).max(100)]).optional().default(""),
  sponsorName: z.string().trim().max(120).optional().default(""),
});

/**
 * Mark an applicant sponsored (full / partial) for programme fees, using the
 * player's sponsorship (scope gains 'program'). Admin / finance of the club,
 * or the programme's head coach. Written with the service role after these
 * checks (the column guard is staff-only); audited with the real actor. The
 * open package invoice gets the "Sponsored" credit note at once.
 */
export async function setApplicantSponsorship(applicationId: string, input: { kind: "none" | "full" | "partial"; percent?: number | string; sponsorName?: string }): Promise<SelectionResult> {
  const { me, t } = await session(["admin", "finance", "coach"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  const id = uuid.safeParse(applicationId);
  const p = sponsorSchema.safeParse(input);
  if (!id.success || !p.success || (p.data.kind === "partial" && p.data.percent === "")) return { ok: false, error: t("selection.errors.invalid") };
  const db = await selectionDb();
  // Visible to the caller under RLS = finance of the club or an assigned coach.
  const { data: app } = await db.from("program_applications").select("id,org_id,program_id,athlete_id,invoice_id,status").eq("id", id.data).eq("org_id", me.orgId).maybeSingle();
  if (!app) return { ok: false, error: t("selection.errors.APPLICATION_NOT_FOUND") };
  const staff = me.roles.includes("admin") || me.roles.includes("finance");
  if (!staff) {
    const { data: head } = await db.rpc("selection_head_coach", { p_program: app.program_id });
    if (head !== true) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  }
  const admin = selectionAdminDb();
  const { data: athRow } = await admin.from("athletes").select("id,sponsorship_kind,sponsorship_scope").eq("id", app.athlete_id).eq("org_id", me.orgId).maybeSingle();
  const ath = athRow as unknown as { id: string; sponsorship_kind: string; sponsorship_scope: string[] | null } | null;
  if (!ath) return { ok: false, error: t("selection.errors.ATHLETE_NOT_FOUND") };
  const scope = new Set<string>(ath.sponsorship_scope ?? []);
  const kind = p.data.kind;
  let update: Record<string, unknown>;
  if (kind === "none") {
    scope.delete("program");
    update = ath.sponsorship_kind === "none" || scope.size === 0
      ? { sponsorship_kind: "none" }
      : { sponsorship_scope: Array.from(scope) };
  } else {
    if (ath.sponsorship_kind === "none") scope.clear();
    scope.add("program");
    update = {
      sponsorship_kind: kind, sponsorship_percent: kind === "full" ? 100 : Number(p.data.percent),
      sponsorship_scope: Array.from(scope), sponsor_name: p.data.sponsorName || null,
    };
  }
  const { error } = await admin.from("athletes").update(update).eq("id", app.athlete_id).eq("org_id", me.orgId);
  if (error) return fail(t, error);
  await admin.from("audit_logs").insert({
    org_id: me.orgId, actor_id: me.id, action: "selection.sponsorship_set", target_table: "program_applications", target_id: app.id,
    new_data: { kind, percent: kind === "partial" ? Number(p.data.percent) : kind === "full" ? 100 : null, sponsor: p.data.sponsorName || null } as unknown as Json,
  });
  if (kind !== "none" && app.invoice_id) {
    const { error: applyErr } = await admin.rpc("sponsorship_apply_service", { p_invoice: app.invoice_id });
    if (applyErr) logError("selection.sponsorshipApply", applyErr);
  }
  revalidate(app.program_id);
  return { ok: true, message: t("selection.sponsor.saved") };
}

// ===========================================================================
// Family (parent app)
// ===========================================================================
const parentApplySchema = z.object({
  programId: uuid,
  athleteId: uuid,
  divisionId: z.union([z.literal(""), uuid]).optional().default(""),
  packageId: uuid,
}).and(applicationExtrasSchema);

export async function applyAsParent(input: z.input<typeof parentApplySchema>): Promise<SelectionResult<{ applicationId: string }>> {
  const { me, t } = await session(["parent", "admin"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  const p = parentApplySchema.safeParse(input);
  if (!p.success) return issues(t, p.error);
  const v = p.data;
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_apply", {
    p_program: v.programId, p_athlete: v.athleteId, p_division: v.divisionId || null, p_package: v.packageId,
    p_payload: { current_club: v.currentClub, position: v.position, notes: v.notes, video_url: v.videoUrl } as unknown as Json,
  });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { application_id?: string; status?: string };
  if (r.application_id) {
    await notifySelection(me.orgId, r.application_id, r.status === "accepted" ? "accepted" : "applied");
    await notifyStaffNewApplication(me.orgId, v.programId);
  }
  revalidate(v.programId);
  return { ok: true, message: t("selection.apply.done"), data: { applicationId: r.application_id ?? "" } };
}

export async function changePackage(applicationId: string, packageId: string): Promise<SelectionResult> {
  const { me, t } = await session(["parent", "admin", "finance"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  if (!uuid.safeParse(applicationId).success || !uuid.safeParse(packageId).success) return { ok: false, error: t("selection.errors.invalid") };
  const db = await selectionDb();
  const { error } = await db.rpc("selection_change_package", { p_application: applicationId, p_package: packageId });
  if (error) return fail(t, error);
  const { data: app } = await db.from("program_applications").select("program_id").eq("id", applicationId).maybeSingle();
  revalidate(app?.program_id);
  return { ok: true, message: t("selection.family.packageChanged") };
}

export async function choosePackagePlan(applicationId: string, count: number): Promise<SelectionResult<{ invoiceId: string | null }>> {
  const { me, t } = await session(["parent", "admin", "finance"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  const n = z.coerce.number().int().min(1).max(24).safeParse(count);
  if (!uuid.safeParse(applicationId).success || !n.success) return { ok: false, error: t("selection.errors.invalid") };
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_choose_plan", { p_application: applicationId, p_count: n.data });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { invoice_id?: string };
  const { data: app } = await db.from("program_applications").select("program_id,status").eq("id", applicationId).maybeSingle();
  if (n.data > 1 && app?.status === "enrolled") await notifySelection(me.orgId, applicationId, "enrolled");
  revalidate(app?.program_id);
  revalidatePath("/parent/payment-plans");
  return { ok: true, message: n.data > 1 ? t("selection.family.planCreated", { count: n.data }) : t("selection.family.payInFullChosen"), data: { invoiceId: r.invoice_id ?? null } };
}

export async function withdrawApplication(applicationId: string, note = ""): Promise<SelectionResult> {
  const { me, t } = await session(["parent", "admin", "coach"]);
  if (!me) return { ok: false, error: t("selection.errors.NOT_AUTHORIZED") };
  if (!uuid.safeParse(applicationId).success) return { ok: false, error: t("selection.errors.invalid") };
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_withdraw", { p_application: applicationId, p_note: note.trim().slice(0, 2000) || null });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { invoice_cancelled?: boolean };
  const { data: app } = await db.from("program_applications").select("program_id").eq("id", applicationId).maybeSingle();
  await notifySelection(me.orgId, applicationId, "withdrawn");
  revalidate(app?.program_id);
  return { ok: true, message: t(r.invoice_cancelled === false ? "selection.family.withdrawnPaid" : "selection.family.withdrawn") };
}

// ===========================================================================
// Public page (non-members): guest family + athlete + application
// ===========================================================================
const publicSchema = z.object({
  programSlug: z.string().min(1).max(200),
  parent: z.object({
    name: z.string().trim().min(1, "selection.errors.required").max(120, "selection.errors.tooLong"),
    email: z.string().trim().email("selection.errors.email").max(200),
    phone: z.string().trim().min(3, "selection.errors.required").max(40, "selection.errors.tooLong"),
    emergencyName: z.string().trim().min(1, "selection.errors.required").max(120, "selection.errors.tooLong"),
    emergencyPhone: z.string().trim().min(3, "selection.errors.required").max(40, "selection.errors.tooLong"),
  }),
  child: z.object({
    firstName: z.string().trim().min(1, "selection.errors.required").max(80, "selection.errors.tooLong"),
    lastName: z.string().trim().min(1, "selection.errors.required").max(80, "selection.errors.tooLong"),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "selection.errors.date"),
    gender: z.string().trim().max(40).optional().default(""),
  }),
  divisionId: z.union([z.literal(""), uuid]).optional().default(""),
  packageId: z.string().uuid("selection.errors.PACKAGE_REQUIRED"),
  consents: z.array(z.string().max(60)).max(20).default([]),
  account: z.object({ mode: z.enum(["none", "password", "link"]), password: z.string().max(200).optional() }).default({ mode: "link" }),
}).and(applicationExtrasSchema);
export type PublicApplyInput = z.input<typeof publicSchema>;

export async function submitSelectionPublic(input: PublicApplyInput): Promise<SelectionResult<{ redirect: string }>> {
  const t0 = await getTranslations();
  const p = publicSchema.safeParse(input);
  if (!p.success) return issues(t0, p.error);
  const v = p.data;
  const sel = await getPublicSelection(v.programSlug);
  if (!sel) return { ok: false, error: t0("selection.errors.PROGRAM_NOT_OPEN") };
  const orgId = sel.program.orgId;
  const t = await getTranslations(orgId);
  try { await requireFeature(orgId, FEATURE); } catch { return { ok: false, error: t("selection.errors.PROGRAM_NOT_OPEN") }; }
  const missing = sel.consents.filter((c) => c.required && !v.consents.includes(c.key));
  if (missing.length) return { ok: false, error: t("registration.consents.missing") };
  if (v.account.mode === "password" && (v.account.password ?? "").length < 8) return { ok: false, error: t("selection.errors.password") };

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const payload = {
    program_id: sel.program.id, division_id: v.divisionId || null, package_id: v.packageId,
    parent: { name: v.parent.name, email: v.parent.email, phone: v.parent.phone, emergency_name: v.parent.emergencyName, emergency_phone: v.parent.emergencyPhone },
    child: { first_name: v.child.firstName, last_name: v.child.lastName, dob: v.child.dob, gender: v.child.gender },
    current_club: v.currentClub, position: v.position, notes: v.notes, video_url: v.videoUrl, consents: v.consents, ip,
  };
  const { data, error } = await selectionAdminDb().rpc("selection_apply_public", { p_payload: payload as unknown as Json });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { application_id?: string; status?: string };
  const account: GuestAccountChoice = v.account.mode === "password" ? { mode: "password", password: v.account.password } : { mode: v.account.mode };
  await createGuestAccount(orgId, v.parent.email, v.parent.name, account, t.locale);
  if (r.application_id) {
    await notifySelection(orgId, r.application_id, r.status === "accepted" ? "accepted" : "applied");
    await notifyStaffNewApplication(orgId, sel.program.id);
  }
  revalidate(sel.program.id);
  const qs = new URLSearchParams({ applied: "1", account: v.account.mode });
  return { ok: true, data: { redirect: `/register/${encodeURIComponent(v.programSlug)}/success?${qs.toString()}` } };
}

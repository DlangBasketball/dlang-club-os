"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { confirmationMatches } from "@/lib/people/person-delete";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import { revalidateSiteLive } from "@/lib/site/revalidate";
import { writeAudit } from "@/lib/people/server";
import { alumniDb, type AlumniClient, type AlumniRow } from "@/lib/alumni/db";
import { getAlumniAccess } from "@/lib/alumni/data";
import { sendAlumniEmail } from "@/lib/alumni/notify";
import { buildAlumniImportPlan, ALUMNI_MAX_BYTES, personKey, type AlumniImportIssue } from "@/lib/alumni/csv";
import {
  alumniErrorKey, alumniSchema, alumniToRow, contactSchema, contactTarget, isMinor, placementSchema, placementToRow,
  sendBlockReason, sendEmailSchema, TARGET_KIND_TO_TYPE, uuid,
  type AlumniInput, type AlumniPlacementInput, type ContactInput, type SendEmailInput,
} from "@/lib/alumni/rules";

/*
 * Alumni & placements — server actions. The club always comes from the
 * session (profiles.org_id); RLS (alumni_staff_can) decides again in SQL:
 * admins of the club and coaches with alumni access; finance and parents
 * never. Validation with zod; messages from the catalogs (alumni.*).
 */
export type AlumniResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string; errors?: Record<string, string> };

type Access = NonNullable<Awaited<ReturnType<typeof getAlumniAccess>>>;

async function session(adminOnly = false): Promise<{ access: Access | null; t: Translator }> {
  const [access, t] = await Promise.all([getAlumniAccess(), getTranslations()]);
  if (!access || (adminOnly && !access.isAdmin)) return { access: null, t };
  return { access, t };
}

const forbidden = (t: Translator) => ({ ok: false as const, error: t("alumni.errors.forbidden") });

function dbFail(t: Translator, scope: string, err: { message?: string } | null | undefined) {
  const key = alumniErrorKey(err?.message);
  if (key === "alumni.errors.generic") logError(scope, err);
  return { ok: false as const, error: t.dynamic(key, undefined, t("alumni.errors.generic")) };
}

function issues(t: Translator, err: z.ZodError) {
  const errors: Record<string, string> = {};
  for (const i of err.issues) errors[i.path.join(".")] = t.dynamic(i.message, undefined, t("alumni.errors.invalid"));
  return { ok: false as const, error: Object.values(errors)[0] ?? t("alumni.errors.invalid"), errors };
}

function revalidate(id?: string | null) {
  for (const base of ["/admin/alumni", "/coach/alumni"]) {
    revalidatePath(base);
    if (id) revalidatePath(`${base}/${id}`);
  }
  revalidatePath("/admin/dashboard");
}

// ===========================================================================
// People
// ===========================================================================
export async function saveAlumni(input: AlumniInput): Promise<AlumniResult<{ id: string }>> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  const p = alumniSchema.safeParse(input);
  if (!p.success) return issues(t, p.error);
  const { me } = access;
  const db = await alumniDb();
  const row = alumniToRow(p.data);
  const { data, error } = p.data.id
    ? await db.from("alumni").update(row).eq("id", p.data.id).eq("org_id", me.orgId).select("id")
    : await db.from("alumni").insert({ ...row, org_id: me.orgId }).select("id");
  if (error) return dbFail(t, "alumni.save", error);
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) return forbidden(t);
  revalidate(id);
  revalidateSiteLive(me.orgId);
  return { ok: true, message: t("alumni.messages.saved"), data: { id } };
}

/** Permanent delete (typed name). Placements and contact log go with it; the audit keeps ids only. */
export async function deleteAlumni(input: { id: string; confirmName: string }): Promise<AlumniResult> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  if (!uuid.safeParse(input.id).success) return { ok: false, error: t("alumni.errors.notFound") };
  const db = await alumniDb();
  const { data: a } = await db.from("alumni").select("first_name,last_name").eq("id", input.id).eq("org_id", access.me.orgId).maybeSingle();
  if (!a) return { ok: false, error: t("alumni.errors.notFound") };
  if (!confirmationMatches(input.confirmName ?? "", `${a.first_name} ${a.last_name}`)) return { ok: false, error: t("alumni.errors.confirmMismatch") };
  const { data, error } = await db.from("alumni").delete().eq("id", input.id).eq("org_id", access.me.orgId).select("id");
  if (error) return dbFail(t, "alumni.delete", error);
  if (!data?.length) return forbidden(t);
  revalidate(input.id);
  revalidateSiteLive(access.me.orgId);
  return { ok: true, message: t("alumni.messages.deleted") };
}

// ===========================================================================
// Placements
// ===========================================================================
export async function saveAlumniPlacement(input: AlumniPlacementInput): Promise<AlumniResult> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  const p = placementSchema.safeParse(input);
  if (!p.success) return issues(t, p.error);
  const db = await alumniDb();
  const row = placementToRow(p.data);
  const { data, error } = p.data.id
    ? await db.from("alumni_placements").update(row).eq("id", p.data.id).eq("alumni_id", p.data.alumniId).eq("org_id", access.me.orgId).select("id")
    : await db.from("alumni_placements").insert({ ...row, alumni_id: p.data.alumniId, org_id: access.me.orgId }).select("id");
  if (error) return dbFail(t, "alumni.placement", error);
  if (!data?.length) return forbidden(t);
  revalidate(p.data.alumniId);
  revalidateSiteLive(access.me.orgId);
  return { ok: true, message: t("alumni.messages.placementSaved") };
}

export async function deleteAlumniPlacement(input: { id: string; alumniId: string }): Promise<AlumniResult> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  if (!uuid.safeParse(input.id).success || !uuid.safeParse(input.alumniId).success) return { ok: false, error: t("alumni.errors.notFound") };
  const db = await alumniDb();
  const { data, error } = await db.from("alumni_placements").delete().eq("id", input.id).eq("alumni_id", input.alumniId).eq("org_id", access.me.orgId).select("id");
  if (error) return dbFail(t, "alumni.placementDelete", error);
  if (!data?.length) return forbidden(t);
  revalidate(input.alumniId);
  revalidateSiteLive(access.me.orgId);
  return { ok: true, message: t("alumni.messages.placementDeleted") };
}

// ===========================================================================
// Contact log & follow-ups
// ===========================================================================
export async function saveAlumniContact(input: ContactInput): Promise<AlumniResult> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  const p = contactSchema.safeParse(input);
  if (!p.success) return issues(t, p.error);
  const db = await alumniDb();
  const row = {
    kind: p.data.kind, direction: p.data.kind === "note" ? "none" : p.data.direction, summary: p.data.summary,
    happened_at: p.data.happenedAt ?? new Date().toISOString(), follow_up_on: p.data.followUpOn,
  };
  const { data, error } = p.data.id
    ? await db.from("alumni_contacts").update(row).eq("id", p.data.id).eq("alumni_id", p.data.alumniId).eq("org_id", access.me.orgId).select("id")
    : await db.from("alumni_contacts").insert({ ...row, alumni_id: p.data.alumniId, org_id: access.me.orgId }).select("id");
  if (error) return dbFail(t, "alumni.contact", error);
  if (!data?.length) return forbidden(t);
  revalidate(p.data.alumniId);
  return { ok: true, message: t("alumni.messages.contactSaved") };
}

export async function setFollowUpDone(input: { id: string; alumniId: string; done: boolean }): Promise<AlumniResult> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  if (!uuid.safeParse(input.id).success || !uuid.safeParse(input.alumniId).success) return { ok: false, error: t("alumni.errors.notFound") };
  const db = await alumniDb();
  const { data, error } = await db.from("alumni_contacts").update({ follow_up_done: Boolean(input.done) })
    .eq("id", input.id).eq("alumni_id", input.alumniId).eq("org_id", access.me.orgId).select("id");
  if (error) return dbFail(t, "alumni.followUp", error);
  if (!data?.length) return forbidden(t);
  revalidate(input.alumniId);
  return { ok: true, message: t(input.done ? "alumni.messages.followUpDone" : "alumni.messages.followUpReopened") };
}

export async function deleteAlumniContact(input: { id: string; alumniId: string }): Promise<AlumniResult> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  if (!uuid.safeParse(input.id).success || !uuid.safeParse(input.alumniId).success) return { ok: false, error: t("alumni.errors.notFound") };
  const db = await alumniDb();
  const { data, error } = await db.from("alumni_contacts").delete().eq("id", input.id).eq("alumni_id", input.alumniId).eq("org_id", access.me.orgId).select("id");
  if (error) return dbFail(t, "alumni.contactDelete", error);
  if (!data?.length) return forbidden(t);
  revalidate(input.alumniId);
  return { ok: true, message: t("alumni.messages.contactDeleted") };
}

/**
 * "Send email from the club": to the alumnus, or to the guardian while the
 * alumnus may be a minor. Refused for "do not contact" and without recorded
 * contact consent. Logged in the contact log (subject + text) and email_logs.
 */
export async function sendAlumniEmailAction(input: SendEmailInput): Promise<AlumniResult> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  const p = sendEmailSchema.safeParse(input);
  if (!p.success) return issues(t, p.error);
  const db = await alumniDb();
  const { data: a } = await db.from("alumni").select("*").eq("id", p.data.alumniId).eq("org_id", access.me.orgId).maybeSingle();
  if (!a) return { ok: false, error: t("alumni.errors.notFound") };
  const person = toContactPerson(a as AlumniRow);
  const blocked = sendBlockReason(person);
  if (blocked) return { ok: false, error: t(`alumni.blocked.${blocked}`) };
  const target = contactTarget(person);
  // Log first (the database refuses outreach to "do not contact" again).
  const { data: logRow, error: logErr } = await db.from("alumni_contacts").insert({
    org_id: access.me.orgId, alumni_id: p.data.alumniId, kind: "email", direction: "outbound",
    summary: `${p.data.subject}\n\n${p.data.body}`.slice(0, 4000), happened_at: new Date().toISOString(), follow_up_on: p.data.followUpOn,
  }).select("id");
  if (logErr) return dbFail(t, "alumni.emailLog", logErr);
  const res = await sendAlumniEmail({
    orgId: access.me.orgId, to: target.email!, subject: p.data.subject, body: p.data.body,
    replyTo: access.me.email, senderName: access.me.fullName,
  });
  if (!res.ok) {
    const id = (logRow as { id: string }[] | null)?.[0]?.id;
    if (id) await db.from("alumni_contacts").delete().eq("id", id).eq("org_id", access.me.orgId);
    return { ok: false, error: t(res.error === "email-not-configured" ? "alumni.errors.emailNotConfigured" : "alumni.errors.emailFailed") };
  }
  revalidate(p.data.alumniId);
  return { ok: true, message: t(target.via === "guardian" ? "alumni.messages.emailSentGuardian" : "alumni.messages.emailSent") };
}

function toContactPerson(a: AlumniRow) {
  return {
    firstName: a.first_name, lastName: a.last_name, birthYear: a.birth_year, birthDate: a.birth_date, email: a.email, phone: a.phone,
    whatsapp: a.whatsapp, guardianName: a.guardian_name, guardianEmail: a.guardian_email, guardianPhone: a.guardian_phone,
    contactConsent: a.contact_consent, status: a.status,
  };
}

// ===========================================================================
// Coach access (admins)
// ===========================================================================
export async function setCoachAlumniAccess(input: { coachId: string; access: boolean }): Promise<AlumniResult> {
  const { access, t } = await session(true);
  if (!access) return forbidden(t);
  if (!uuid.safeParse(input.coachId).success) return { ok: false, error: t("alumni.errors.notFound") };
  const db = await alumniDb();
  const { data, error } = await db.from("coaches").update({ alumni_access: Boolean(input.access) }).eq("id", input.coachId).eq("org_id", access.me.orgId).select("id");
  if (error) return dbFail(t, "alumni.coachAccess", error);
  if (!data?.length) return forbidden(t);
  revalidatePath("/admin/alumni");
  revalidatePath("/coach", "layout");
  return { ok: true, message: t(input.access ? "alumni.messages.accessGranted" : "alumni.messages.accessRemoved") };
}

// ===========================================================================
// From the player app: "Move to alumni" and journey placements
// ===========================================================================
type AthleteLite = { id: string; first_name: string; last_name: string; dob: string | null; gender: string | null; nationality: string | null; family_id: string };

async function loadAthlete(db: AlumniClient, orgId: string, athleteId: string): Promise<AthleteLite | null> {
  const { data } = await db.from("athletes").select("id,first_name,last_name,dob,gender,nationality,family_id,status").eq("id", athleteId).eq("org_id", orgId).maybeSingle();
  const a = data as (AthleteLite & { status: string }) | null;
  return a && a.status !== "erased" ? a : null;
}

export type MovePreview = {
  name: string; birthYear: number | null; minor: boolean; guardianName: string | null; guardianEmail: string | null;
  guardianPhone: string | null; placements: { id: string; name: string; status: string }[]; existingAlumniId: string | null;
};

/** What "Move to alumni" will copy (names, birth year, family contact, journey placements). */
export async function previewMoveToAlumni(athleteId: string): Promise<AlumniResult<MovePreview>> {
  const { access, t } = await session(true);
  if (!access) return forbidden(t);
  if (!uuid.safeParse(athleteId).success) return { ok: false, error: t("alumni.errors.notFound") };
  const db = await alumniDb();
  const a = await loadAthlete(db, access.me.orgId, athleteId);
  if (!a) return { ok: false, error: t("alumni.errors.notFound") };
  const [{ data: fam }, { data: targets }, { data: existing }] = await Promise.all([
    db.from("families").select("contact_name,contact_email,phone").eq("id", a.family_id).eq("org_id", access.me.orgId).maybeSingle(),
    db.from("placement_targets").select("id,target_name,status").eq("athlete_id", athleteId).eq("org_id", access.me.orgId),
    db.from("alumni").select("id").eq("athlete_id", athleteId).eq("org_id", access.me.orgId).maybeSingle(),
  ]);
  const by = a.dob ? Number(a.dob.slice(0, 4)) : null;
  return {
    ok: true,
    data: {
      name: `${a.first_name} ${a.last_name}`, birthYear: by, minor: isMinor({ birthYear: by }),
      guardianName: fam?.contact_name ?? null, guardianEmail: fam?.contact_email ?? null, guardianPhone: fam?.phone ?? null,
      placements: ((targets ?? []) as { id: string; target_name: string; status: string }[]).filter((x) => x.status === "placed" || x.status === "offer")
        .map((x) => ({ id: x.id, name: x.target_name, status: x.status })),
      existingAlumniId: (existing as { id: string } | null)?.id ?? null,
    },
  };
}

const GENDER_IN: Record<string, "female" | "male" | "other"> = { female: "female", f: "female", male: "male", m: "male", other: "other" };

/** Find (or create) the alumni record of a player of this club; copies names, birth year and family contact. */
async function ensureAlumniForAthlete(db: AlumniClient, orgId: string, a: AthleteLite): Promise<{ id: string } | { error: { message?: string } }> {
  const { data: existing } = await db.from("alumni").select("id").eq("athlete_id", a.id).eq("org_id", orgId).maybeSingle();
  if (existing) return { id: (existing as { id: string }).id };
  const { data: fam } = await db.from("families").select("contact_name,contact_email,phone").eq("id", a.family_id).eq("org_id", orgId).maybeSingle();
  const phone = fam?.phone && /^\+?[0-9 ().-]{4,40}$/.test(fam.phone) ? fam.phone : null;
  const { data, error } = await db.from("alumni").insert({
    org_id: orgId, athlete_id: a.id, first_name: a.first_name, last_name: a.last_name,
    birth_year: a.dob ? Number(a.dob.slice(0, 4)) : null,
    gender: a.gender ? GENDER_IN[a.gender.trim().toLowerCase()] ?? null : null,
    nationality: a.nationality?.slice(0, 80) ?? null,
    guardian_name: fam?.contact_name?.slice(0, 160) ?? null, guardian_email: fam?.contact_email ?? null, guardian_phone: phone,
  }).select("id");
  if (error) return { error };
  return { id: (data as { id: string }[])[0]!.id };
}

async function copyTargets(db: AlumniClient, orgId: string, alumniId: string, targetIds: string[]): Promise<number> {
  if (!targetIds.length) return 0;
  const [{ data: targets }, { data: done }] = await Promise.all([
    db.from("placement_targets").select("id,target_name,target_kind,country,level,status,notes").in("id", targetIds).eq("org_id", orgId),
    db.from("alumni_placements").select("placement_target_id").in("placement_target_id", targetIds).eq("org_id", orgId),
  ]);
  const have = new Set(((done ?? []) as { placement_target_id: string | null }[]).map((d) => d.placement_target_id));
  const rows = ((targets ?? []) as { id: string; target_name: string; target_kind: string; country: string | null; level: string | null; status: string }[])
    .filter((x) => !have.has(x.id))
    .map((x) => ({
      org_id: orgId, alumni_id: alumniId, placement_target_id: x.id, institution: x.target_name.slice(0, 160),
      institution_type: TARGET_KIND_TO_TYPE[x.target_kind] ?? "other", country: x.country, level: x.level,
      status: "committed", is_current: true, scholarship: "unknown",
    }));
  if (!rows.length) return 0;
  const { error } = await db.from("alumni_placements").insert(rows);
  if (error) {
    logError("alumni.copyTargets", error);
    return 0;
  }
  return rows.length;
}

/** "Move to alumni" on a player profile; optionally archives the player through the normal delete flow. */
export async function moveAthleteToAlumni(input: { athleteId: string; archive: boolean }): Promise<AlumniResult<{ id: string }>> {
  const { access, t } = await session(true);
  if (!access) return forbidden(t);
  if (!uuid.safeParse(input.athleteId).success) return { ok: false, error: t("alumni.errors.notFound") };
  const orgId = access.me.orgId;
  const db = await alumniDb();
  const a = await loadAthlete(db, orgId, input.athleteId);
  if (!a) return { ok: false, error: t("alumni.errors.notFound") };
  const res = await ensureAlumniForAthlete(db, orgId, a);
  if ("error" in res) return dbFail(t, "alumni.move", res.error);
  const { data: targets } = await db.from("placement_targets").select("id,status").eq("athlete_id", a.id).eq("org_id", orgId);
  await copyTargets(db, orgId, res.id, ((targets ?? []) as { id: string; status: string }[]).filter((x) => x.status === "placed").map((x) => x.id));
  let message = t("alumni.messages.moved");
  if (input.archive) {
    const rpc = (await createClient()).rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    const { error } = await rpc("delete_athlete", { p_athlete: a.id, p_mode: "archive" });
    if (error) {
      logError("alumni.moveArchive", error);
      message = t("alumni.messages.movedNotArchived");
    } else {
      message = t("alumni.messages.movedArchived");
      revalidatePersonEverywhere(orgId);
    }
  }
  await writeAudit({ id: access.me.id, orgId }, "alumni.moved_from_player", "athletes", a.id, { archived: Boolean(input.archive) });
  revalidate(res.id);
  return { ok: true, message, data: { id: res.id } };
}

/** Player journey: a target marked "placed" -> the player's alumni record + this placement (idempotent). */
export async function addJourneyPlacementToAlumni(placementTargetId: string): Promise<AlumniResult<{ id: string }>> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  if (!uuid.safeParse(placementTargetId).success) return { ok: false, error: t("alumni.errors.notFound") };
  const orgId = access.me.orgId;
  const db = await alumniDb();
  const { data: target } = await db.from("placement_targets").select("id,athlete_id,status").eq("id", placementTargetId).eq("org_id", orgId).maybeSingle();
  const tg = target as { id: string; athlete_id: string; status: string } | null;
  if (!tg) return { ok: false, error: t("alumni.errors.notFound") };
  if (tg.status !== "placed") return { ok: false, error: t("alumni.errors.notPlaced") };
  const a = await loadAthlete(db, orgId, tg.athlete_id);
  if (!a) return { ok: false, error: t("alumni.errors.notFound") };
  const res = await ensureAlumniForAthlete(db, orgId, a);
  if ("error" in res) return dbFail(t, "alumni.journey", res.error);
  await copyTargets(db, orgId, res.id, [tg.id]);
  revalidate(res.id);
  for (const base of ["/admin/journey", "/coach/journey"]) revalidatePath(`${base}/${tg.athlete_id}`);
  return { ok: true, message: t("alumni.messages.addedFromJourney"), data: { id: res.id } };
}

// ===========================================================================
// CSV import
// ===========================================================================
export type ImportSummary = { people: number; created: number; matched: number; placements: number; skippedRows: number; issues: AlumniImportIssue[] };

/** Import (or dry-run) a CSV: people matched by email, else name + birth year; duplicate placements skipped. */
export async function importAlumniCsv(input: { csv: string; dateOrder: "DMY" | "MDY"; dryRun: boolean }): Promise<AlumniResult<ImportSummary>> {
  const { access, t } = await session();
  if (!access) return forbidden(t);
  if (typeof input.csv !== "string" || !input.csv.trim()) return { ok: false, error: t("alumni.import.issues.empty") };
  if (input.csv.length > ALUMNI_MAX_BYTES) return { ok: false, error: t("alumni.import.tooLarge") };
  const plan = buildAlumniImportPlan(input.csv, input.dateOrder === "MDY" ? "MDY" : "DMY");
  const fatal = plan.issues.find((i) => i.row === 0);
  if (fatal) return { ok: false, error: t.dynamic(`alumni.import.issues.${fatal.key}`, { field: fatal.field ?? "", value: fatal.value ?? "" }) };
  const orgId = access.me.orgId;
  const db = await alumniDb();
  const { data: existing } = await db.from("alumni").select("id,first_name,last_name,birth_year,email").eq("org_id", orgId).limit(10000);
  const known = new Map<string, string>();
  for (const e of (existing ?? []) as { id: string; first_name: string; last_name: string; birth_year: number | null; email: string | null }[]) {
    known.set(personKey(e), e.id);
    if (e.email) known.set(personKey({ ...e, email: null }), e.id);
  }
  const { data: plRows } = await db.from("alumni_placements").select("alumni_id,institution,institution_type").eq("org_id", orgId).limit(20000);
  const havePl = new Set(((plRows ?? []) as { alumni_id: string; institution: string; institution_type: string }[]).map((p) => `${p.alumni_id}|${p.institution.toLowerCase()}|${p.institution_type}`));

  const summary: ImportSummary = { people: plan.people, created: 0, matched: 0, placements: 0, skippedRows: 0, issues: plan.issues };
  const seen = new Map<string, string>(); // personKey -> id (or a dry-run token)
  for (const r of plan.rows) {
    const k = personKey(r.person);
    let id = seen.get(k) ?? known.get(k) ?? known.get(personKey({ ...r.person, email: null })) ?? null;
    if (id && !seen.has(k)) summary.matched += 1;
    if (!id) {
      if (input.dryRun) id = `new:${k}`;
      else {
        const { data, error } = await db.from("alumni").insert({ ...r.person, org_id: orgId }).select("id");
        if (error) {
          summary.skippedRows += 1;
          summary.issues.push({ row: r.row, key: alumniErrorKey(error.message) === "alumni.errors.ALUMNI_GUARDIAN_REQUIRED" ? "guardianRequired" : "rowFailed" });
          continue;
        }
        id = (data as { id: string }[])[0]!.id;
      }
      summary.created += 1;
    }
    seen.set(k, id);
    if (r.placement) {
      const pk = `${id}|${r.placement.institution.toLowerCase()}|${r.placement.institution_type}`;
      if (havePl.has(pk)) continue;
      havePl.add(pk);
      if (!input.dryRun) {
        const { error } = await db.from("alumni_placements").insert({ ...r.placement, alumni_id: id, org_id: orgId });
        if (error) {
          summary.issues.push({ row: r.row, key: "placementFailed" });
          continue;
        }
      }
      summary.placements += 1;
    }
  }
  if (!input.dryRun) {
    await writeAudit({ id: access.me.id, orgId }, "alumni.imported", "alumni", null, { created: summary.created, placements: summary.placements });
    revalidate();
    revalidateSiteLive(orgId);
  }
  return {
    ok: true,
    message: input.dryRun ? t("alumni.import.checked") : t("alumni.import.done", { created: summary.created, placements: summary.placements }),
    data: summary,
  };
}

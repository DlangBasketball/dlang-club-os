"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { familyAdminDb, familyDb } from "@/lib/family/db";
import { audit, fail, failDb, myFamilyIds, ok, requireMember, type FamilyResult } from "@/lib/family/action-helpers";
import { consentSchema, correctionSchema, erasureSchema, type ConsentInput } from "@/lib/family/validation";
import { buildExportHtml, type ExportSection } from "@/lib/family/privacy-export";
import { notifyMembers } from "@/lib/family/notify";
import { getI18n } from "@/lib/i18n/server";
import { logError } from "@/lib/log";

const EXPORT_BUCKET = "privacy-exports";
const LINK_SECONDS = 60 * 60;
const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);

async function jurisdiction(orgId: string): Promise<"CH" | "EU" | "UK" | "US" | "OTHER"> {
  const { data } = await familyAdminDb().from("organizations").select("country").eq("id", orgId).maybeSingle();
  const c = String((data as { country?: string | null } | null)?.country ?? "CH").toUpperCase();
  if (c === "CH" || c === "LI") return "CH";
  if (c === "GB" || c === "UK") return "UK";
  if (c === "US") return "US";
  return EU.has(c) ? "EU" : "OTHER";
}

/** Tell the club's admins about a new privacy request (in-app + push). */
async function notifyAdmins(orgId: string, kind: "correction" | "erasure") {
  const { data: admins } = await familyAdminDb().from("staff_roles").select("profile_id").eq("org_id", orgId).eq("role", "admin");
  await notifyMembers({
    orgId, profileIds: (admins ?? []).map((a) => a.profile_id), category: "alerts", type: "system", app: "admin",
    build: ({ t }) => ({ title: t(`family.push.privacy.${kind}`), body: null, path: "/admin/settings/privacy" }),
  });
}

/**
 * "Download my family's data": JSON (machine-readable) + a readable HTML
 * summary, stored in the private privacy-exports bucket and handed out as
 * signed links valid for one hour. Everything is read with the guardian's
 * own session (RLS), so the export holds exactly what they may see. Audited
 * and recorded as a completed access request.
 */
export async function generateFamilyExport(): Promise<FamilyResult<{ jsonUrl: string; htmlUrl: string; expiresAt: string }>> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const families = await myFamilyIds(me);
  if (!families.length) return fail("noFamily");
  const familyId = families[0]!;
  const db = await familyDb();
  const { t, f, ctx } = await getI18n();

  const q = await Promise.all([
    db.from("profiles").select("id,full_name,email,phone,locale,created_at").eq("id", me.id),
    db.from("families").select("*").in("id", families),
    db.from("family_members").select("family_id,profile_id,relation,is_primary,can_pay,can_see_medical,receives_emails,billing_share_pct").in("family_id", families),
    db.from("athletes").select("*").in("family_id", families),
    db.from("athlete_medical").select("*"),
    db.from("registrations").select("*"),
    db.from("invoices").select("*").in("family_id", families),
    db.from("consent_acceptances").select("*"),
    db.from("family_consent_events").select("kind,athlete_id,profile_id,granted,version,source,created_at").in("family_id", families),
    db.from("documents").select("id,kind,file_name,mime_type,created_at,athlete_id,family_id"),
    db.from("attendance_marks").select("athlete_id,status,marked_at"),
    db.from("training_bookings").select("*"),
    db.from("player_season_reviews").select("season_label,coach_comment,awards,athlete_id,created_at"),
    db.from("placement_targets").select("target_name,target_kind,status,deadline,athlete_id,updated_at"),
    db.from("carpool_offers").select("event_id,from_area,departs_at,seats_total,status").eq("profile_id", me.id),
    db.from("carpool_requests").select("event_id,from_area,seats_needed,status").eq("profile_id", me.id),
    db.from("notification_preferences").select("channels,quiet_start,quiet_end").eq("profile_id", me.id),
    db.from("push_subscriptions").select("user_agent,created_at,last_success_at"),
    db.from("dsar_requests").select("request_type,status,received_at,completed_at"),
  ]);
  const keys = [
    "profile", "families", "guardians", "children", "medical", "registrations", "invoices", "consents", "consentHistory",
    "documents", "attendance", "bookings", "seasonReviews", "placements", "carpoolOffers", "carpoolRequests",
    "notificationPreferences", "devices", "privacyRequests",
  ] as const;
  const data: Record<string, Record<string, unknown>[]> = {};
  keys.forEach((k, i) => {
    data[k] = ((q[i]?.data ?? []) as unknown as Record<string, unknown>[]);
  });

  const generatedAt = new Date().toISOString();
  const json = JSON.stringify({ exportedAt: generatedAt, subject: { id: me.id, email: me.email }, ...data }, null, 2);
  const sections: ExportSection[] = keys.map((k) => ({ key: k, title: t.dynamic(`family.privacy.export.sections.${k}`, {}, k), rows: data[k] ?? [] }));
  const html = buildExportHtml({
    title: t("family.privacy.export.docTitle"),
    intro: t("family.privacy.export.docIntro"),
    generatedLabel: t("family.privacy.export.generated"),
    generatedAt,
    emptyLabel: t("family.privacy.export.empty"),
    sections,
    lang: ctx.locale,
    fmtDate: (iso) => (iso.length > 10 ? f.dateTime(iso) : f.date(iso)),
  });

  const admin = familyAdminDb();
  const base = `${me.orgId}/${familyId}/${generatedAt.replace(/[:.]/g, "-")}-${randomBytes(6).toString("hex")}`;
  const up1 = await admin.storage.from(EXPORT_BUCKET).upload(`${base}.json`, new Blob([json], { type: "application/json" }), { contentType: "application/json", upsert: false });
  const up2 = await admin.storage.from(EXPORT_BUCKET).upload(`${base}.html`, new Blob([html], { type: "text/html" }), { contentType: "text/html; charset=utf-8", upsert: false });
  if (up1.error || up2.error) {
    logError("family.export.upload", up1.error ?? up2.error);
    return fail("exportFailed");
  }
  const [s1, s2] = await Promise.all([
    admin.storage.from(EXPORT_BUCKET).createSignedUrl(`${base}.json`, LINK_SECONDS, { download: "family-data.json" }),
    admin.storage.from(EXPORT_BUCKET).createSignedUrl(`${base}.html`, LINK_SECONDS, { download: "family-data.html" }),
  ]);
  if (!s1.data?.signedUrl || !s2.data?.signedUrl) return fail("exportFailed");

  await admin.from("dsar_requests").insert({
    org_id: me.orgId, family_id: familyId, requester_profile_id: me.id, requester_name: me.fullName ?? "—",
    request_type: "portability", channel: "in_app", relationship: "parent_guardian", jurisdiction: await jurisdiction(me.orgId),
    status: "completed", identity_verified_at: generatedAt, response_summary: "self-service export",
  } as never);
  await audit(me, "privacy.export_generated", "families", familyId, { path: base, sections: keys.length });
  revalidatePath("/parent/privacy");
  return ok("family.messages.exportReady", {
    jsonUrl: s1.data.signedUrl, htmlUrl: s2.data.signedUrl, expiresAt: new Date(Date.now() + LINK_SECONDS * 1000).toISOString(),
  });
}

/** Ask the club to correct data (GDPR Art. 16 / nFADP Art. 32). */
export async function requestCorrection(input: { details: string; athleteId?: string | null }): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const p = correctionSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const families = await myFamilyIds(me);
  if (!families.length) return fail("noFamily");
  const admin = familyAdminDb();
  if (p.data.athleteId) {
    const { data: a } = await admin.from("athletes").select("id").eq("id", p.data.athleteId).eq("org_id", me.orgId).in("family_id", families).maybeSingle();
    if (!a) return fail("NOT_FOUND");
  }
  const { error } = await admin.from("dsar_requests").insert({
    org_id: me.orgId, family_id: families[0], athlete_id: p.data.athleteId ?? null, requester_profile_id: me.id,
    requester_name: me.fullName ?? "—", request_type: "rectification", channel: "in_app", relationship: "parent_guardian",
    jurisdiction: await jurisdiction(me.orgId), notes: p.data.details,
  } as never);
  if (error) return failDb("family.correction", error);
  await audit(me, "privacy.correction_requested", "families", families[0]!);
  await notifyAdmins(me.orgId, "correction");
  revalidatePath("/parent/privacy");
  return ok("family.messages.correctionSent");
}

/**
 * Ask for erasure: creates a deletion request the club admin approves (then
 * anonymise_family() runs; invoices and payments are kept for the legal
 * retention period) and a linked DSAR with its statutory due date.
 */
export async function requestErasure(input: { reason?: string; confirm: boolean }): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const p = erasureSchema.safeParse(input);
  if (!p.success) return fail("confirmRequired");
  const families = await myFamilyIds(me);
  if (!families.length) return fail("noFamily");
  const familyId = families[0]!;
  const admin = familyAdminDb();
  const { data: pending } = await admin.from("deletion_requests").select("id").eq("org_id", me.orgId).eq("family_id", familyId).eq("status", "pending").maybeSingle();
  if (pending) return fail("erasurePending");
  const { data: del, error } = await admin
    .from("deletion_requests")
    .insert({ org_id: me.orgId, family_id: familyId, requested_by: me.id, reason: p.data.reason.slice(0, 1000) || null })
    .select("id")
    .single();
  if (error || !del) return failDb("family.erasure", error);
  await admin.from("dsar_requests").insert({
    org_id: me.orgId, family_id: familyId, requester_profile_id: me.id, requester_name: me.fullName ?? "—",
    request_type: "erasure", channel: "in_app", relationship: "parent_guardian", jurisdiction: await jurisdiction(me.orgId),
    deletion_request_id: del.id, notes: p.data.reason || null,
  } as never);
  await audit(me, "privacy.erasure_requested", "families", familyId, { deletion_request_id: del.id });
  await notifyAdmins(me.orgId, "erasure");
  revalidatePath("/parent/privacy");
  return ok("family.messages.erasureSent");
}

/** Media consent (per child) or marketing consent (per guardian); history is append-only. */
export async function setFamilyConsent(input: ConsentInput): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const p = consentSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const families = await myFamilyIds(me);
  if (!families.length) return fail("noFamily");
  let familyId = families[0]!;
  if (p.data.athleteId) {
    const { data: a } = await familyAdminDb().from("athletes").select("family_id").eq("id", p.data.athleteId).eq("org_id", me.orgId).in("family_id", families).maybeSingle();
    if (!a) return fail("NOT_FOUND");
    familyId = a.family_id;
  }
  const db = await familyDb();
  const { error } = await db.from("family_consent_events").insert({
    org_id: me.orgId, family_id: familyId, athlete_id: p.data.kind === "marketing" ? null : p.data.athleteId, profile_id: me.id,
    kind: p.data.kind, granted: p.data.granted, version: "1", source: "parent_app",
  });
  if (error) return failDb("family.consent", error);
  revalidatePath("/parent/privacy");
  return ok(p.data.granted ? "family.messages.consentGiven" : "family.messages.consentWithdrawn");
}

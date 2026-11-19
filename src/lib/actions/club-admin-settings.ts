"use server";

import { revalidatePath } from "next/cache";
import { caDb } from "@/lib/club-admin/db";
import { audit, dbErrorKey, done, fail, requireMe, type CaResult } from "@/lib/club-admin/server";
import { ahvSchema, coachJsNumberSchema, firstIssueKey, jsOfferSchema, settingsSchema, type ClubAdminSettingsInput } from "@/lib/club-admin/validation";

/** Club-admin settings (waitlist, membership, J+S, compliance) and J+S data. Admin only. */
export async function saveClubAdminSettings(input: ClubAdminSettingsInput): Promise<CaResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = settingsSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const v = p.data;
  const row = {
    org_id: me.orgId,
    waitlist_offer_hours: v.waitlistOfferHours,
    waitlist_auto_offer: v.waitlistAutoOffer,
    membership_renewal_window_days: v.membershipRenewalWindowDays,
    js_enabled: v.jsEnabled,
    js_club_number: v.jsClubNumber,
    js_age_min: v.jsAgeMin,
    js_age_max: v.jsAgeMax,
    js_rate_per_participant_hour: v.jsRatePerParticipantHour,
    compliance_block_youth: v.complianceBlockYouth,
    compliance_mandatory_kinds: Array.from(new Set(v.complianceMandatoryKinds)),
    compliance_reminder_days: Array.from(new Set(v.complianceReminderDays)).sort((a, b) => b - a),
    updated_by: me.id,
  };
  const { error } = await (await caDb()).from("club_admin_settings").upsert(row, { onConflict: "org_id" });
  if (error) return fail(dbErrorKey(error.message));
  await audit(me, "club_admin.settings", "club_admin_settings", null);
  for (const path of ["/admin/waitlists", "/admin/memberships", "/admin/js", "/admin/staff-compliance"]) revalidatePath(path);
  return done("clubadmin.saved");
}

export async function saveJsOffer(input: { programId: string; jsOffer: boolean; jsOfferNumber?: string | null; jsSessionMinutes?: number | string | null }): Promise<CaResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = jsOfferSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const { data, error } = await (await caDb()).from("programs")
    .update({ js_offer: p.data.jsOffer, js_offer_number: p.data.jsOfferNumber, js_session_minutes: p.data.jsSessionMinutes })
    .eq("id", p.data.programId).eq("org_id", me.orgId).select("id");
  if (error) return fail(dbErrorKey(error.message));
  if (!data?.length) return fail("clubadmin.errors.notFound");
  await audit(me, "js.offer", "programs", p.data.programId, { js_offer: p.data.jsOffer });
  revalidatePath("/admin/js");
  return done("clubadmin.saved");
}

export async function saveCoachJsNumber(input: { coachId: string; number: string | null }): Promise<CaResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = coachJsNumberSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const { data, error } = await (await caDb()).from("coaches").update({ js_person_number: p.data.number })
    .eq("id", p.data.coachId).eq("org_id", me.orgId).select("id");
  if (error) return fail(dbErrorKey(error.message));
  if (!data?.length) return fail("clubadmin.errors.notFound");
  await audit(me, "js.coach_number", "coaches", p.data.coachId);
  revalidatePath("/admin/js");
  return done("clubadmin.saved");
}

/** Store / clear an athlete's AHV number (consent mandatory; encrypted in the database). */
export async function setAthleteAhv(input: { athleteId: string; ahv: string | null; consentNote?: string }): Promise<CaResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = ahvSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const { error } = await (await caDb()).rpc("set_athlete_ahv", {
    p_athlete: p.data.athleteId, p_ahv: p.data.ahv, p_consent_note: p.data.consentNote || null,
  });
  if (error) return fail(dbErrorKey(error.message));
  revalidatePath("/admin/js");
  return done(p.data.ahv ? "clubadmin.js.ahvSaved" : "clubadmin.js.ahvCleared");
}

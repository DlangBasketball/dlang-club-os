"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import { familyDb } from "@/lib/family/db";
import { audit, fail, failDb, ok, requireMember, type FamilyResult } from "@/lib/family/action-helpers";
import { placementSchema, scoutPublishSchema, seasonReviewSchema, SCOUT_CONSENT_VERSION, uuid, type PlacementInput, type ScoutPublishInput, type SeasonReviewInput } from "@/lib/family/validation";
import { generateScoutToken } from "@/lib/family/scout";
import { getOrgEmailContext } from "@/lib/email/org-context";

function revalidateJourney(athleteId: string) {
  for (const base of ["/admin/journey", "/coach/journey", "/parent/journey"]) {
    revalidatePath(base);
    revalidatePath(`${base}/${athleteId}`);
  }
}

const isStaff = (roles: string[]) => roles.includes("admin") || roles.includes("coach");

/** End-of-season review (coach comment + awards). Admin / the athlete's coach (RLS). */
export async function saveSeasonReview(input: SeasonReviewInput): Promise<FamilyResult> {
  await assertFeature("player_journey");
  const me = await requireMember();
  if (!me || !isStaff(me.roles)) return fail("forbidden");
  const p = seasonReviewSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const db = await familyDb();
  const row = {
    athlete_id: p.data.athleteId, season_id: p.data.seasonId ?? null, season_label: p.data.seasonLabel,
    coach_comment: p.data.coachComment, awards: p.data.awards, shared_with_family: p.data.sharedWithFamily,
  };
  const { data, error } = p.data.id
    ? await db.from("player_season_reviews").update(row).eq("id", p.data.id).eq("org_id", me.orgId).select("id")
    : await db.from("player_season_reviews").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (error) return failDb("family.journey.review", error);
  if (!data?.length) return fail("NOT_ALLOWED");
  revalidateJourney(p.data.athleteId);
  return ok("family.messages.reviewSaved");
}

export async function deleteSeasonReview(input: { id: string; athleteId: string }): Promise<FamilyResult> {
  await assertFeature("player_journey");
  const me = await requireMember();
  if (!me || !isStaff(me.roles)) return fail("forbidden");
  if (!uuid.safeParse(input.id).success || !uuid.safeParse(input.athleteId).success) return fail("invalid");
  const db = await familyDb();
  const { data, error } = await db.from("player_season_reviews").delete().eq("id", input.id).eq("org_id", me.orgId).select("id");
  if (error) return failDb("family.journey.reviewDelete", error);
  if (!data?.length) return fail("NOT_ALLOWED");
  revalidateJourney(input.athleteId);
  return ok("family.messages.deleted");
}

/** Placement / scholarship target (admin / coach; guardians read only). */
export async function savePlacement(input: PlacementInput): Promise<FamilyResult> {
  await assertFeature("player_journey");
  const me = await requireMember();
  if (!me || !isStaff(me.roles)) return fail("forbidden");
  const p = placementSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const db = await familyDb();
  const row = {
    athlete_id: p.data.athleteId, target_name: p.data.targetName, target_kind: p.data.targetKind, country: p.data.country,
    level: p.data.level, status: p.data.status, deadline: p.data.deadline ?? null, next_step: p.data.nextStep, notes: p.data.notes,
    document_ids: p.data.documentIds, updated_by: me.id,
  };
  const { data, error } = p.data.id
    ? await db.from("placement_targets").update(row).eq("id", p.data.id).eq("org_id", me.orgId).select("id")
    : await db.from("placement_targets").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (error) return failDb("family.journey.placement", error);
  if (!data?.length) return fail("NOT_ALLOWED");
  revalidateJourney(p.data.athleteId);
  return ok("family.messages.placementSaved");
}

export async function deletePlacement(input: { id: string; athleteId: string }): Promise<FamilyResult> {
  await assertFeature("player_journey");
  const me = await requireMember();
  if (!me || !isStaff(me.roles)) return fail("forbidden");
  if (!uuid.safeParse(input.id).success || !uuid.safeParse(input.athleteId).success) return fail("invalid");
  const db = await familyDb();
  const { data, error } = await db.from("placement_targets").delete().eq("id", input.id).eq("org_id", me.orgId).select("id");
  if (error) return failDb("family.journey.placementDelete", error);
  if (!data?.length) return fail("NOT_ALLOWED");
  revalidateJourney(input.athleteId);
  return ok("family.messages.deleted");
}

/**
 * Publish the scout profile: guardians only, with explicit consent, chosen
 * fields, an expiry. A fresh link token is generated each time (the old link
 * stops working); only its hash is stored. The link is shown once.
 */
export async function publishScoutProfile(input: ScoutPublishInput): Promise<FamilyResult<{ url: string; expiresAt: string }>> {
  await assertFeature("player_journey");
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const p = scoutPublishSchema.safeParse(input);
  if (!p.success) return fail(input.consent !== true ? "consentRequired" : "invalid");
  const { token, hash } = generateScoutToken();
  const db = await familyDb();
  const { error } = await db.rpc("scout_profile_publish", {
    p_athlete: p.data.athleteId, p_fields: p.data.fields, p_days: p.data.days, p_token_hash: hash,
    p_headline: p.data.headline, p_consent_version: SCOUT_CONSENT_VERSION,
  });
  if (error) return failDb("family.scout.publish", error);
  await audit(me, "scout.published", "athletes", p.data.athleteId, { fields: p.data.fields, days: p.data.days });
  const org = await getOrgEmailContext(me.orgId);
  revalidateJourney(p.data.athleteId);
  return ok("family.messages.scoutPublished", {
    url: org.link(`/scout/${token}`),
    expiresAt: new Date(Date.now() + p.data.days * 864e5).toISOString(),
  });
}

export async function revokeScoutProfile(athleteId: string): Promise<FamilyResult> {
  await assertFeature("player_journey");
  const me = await requireMember();
  if (!me) return fail("forbidden");
  if (!uuid.safeParse(athleteId).success) return fail("invalid");
  const db = await familyDb();
  const { error } = await db.rpc("scout_profile_revoke", { p_athlete: athleteId });
  if (error) return failDb("family.scout.revoke", error);
  await audit(me, "scout.revoked", "athletes", athleteId);
  revalidateJourney(athleteId);
  return ok("family.messages.scoutRevoked");
}

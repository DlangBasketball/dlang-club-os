"use server";

import { revalidatePath } from "next/cache";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { sportsDb } from "@/lib/sportsops/db";
import { logError } from "@/lib/log";
import {
  assignToTeamSchema,
  moveMembershipSchema,
  removeMembershipSchema,
  rosterErrorKey,
  rosterIssueKey,
  updateMembershipSchema,
  type AssignToTeamInput,
  type MoveMembershipInput,
  type UpdateMembershipInput,
} from "@/lib/sportsops/roster-validation";

/**
 * Team assignment from the player profile and the team roster (admins).
 * team_memberships RLS (admin of the org, or coach of the team) and the
 * same-org trigger enforce the tenant; the row-level audit trigger records
 * every change and writeAudit() adds the intent.
 */

function revalidateRoster(athleteId: string, teamIds: (string | null | undefined)[]) {
  revalidatePath(`/admin/athletes/${athleteId}`);
  revalidatePath(`/admin/athletes/${athleteId}/edit`);
  revalidatePath(`/parent/children/${athleteId}`);
  revalidatePath("/admin/teams");
  for (const id of teamIds) if (id) revalidatePath(`/admin/teams/${id}`);
  revalidatePath("/coach/team");
}

async function loadMembership(membershipId: string, orgId: string) {
  const db = await sportsDb();
  const { data } = await db
    .from("team_memberships")
    .select("id,team_id,athlete_id,jersey_number,position,status")
    .eq("id", membershipId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data;
}

async function teamInOrg(teamId: string, orgId: string): Promise<{ id: string; name: string; is_active: boolean } | null> {
  const db = await sportsDb();
  const { data } = await db.from("teams").select("id,name,is_active").eq("id", teamId).eq("org_id", orgId).maybeSingle();
  return data;
}

/** Add a player to a team (optional jersey number and position). */
export async function assignToTeam(input: AssignToTeamInput): Promise<ActionResult<{ membershipId: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("media.errors.forbidden") };
  const p = assignToTeamSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(rosterIssueKey(p.error)) };
  const team = await teamInOrg(p.data.teamId, me.orgId);
  if (!team) return { ok: false, error: t("media.roster.errors.teamNotFound") };

  const db = await sportsDb();
  // A selection programme's division team: the roster follows the enrolment
  // (application, registration, fee agreement), so add the player there.
  const { data: div } = await (db.from("program_divisions" as never) as unknown as {
    select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { limit: (n: number) => Promise<{ data: { program_id: string }[] | null }> } } };
  }).select("program_id").eq("team_id", p.data.teamId).eq("org_id", me.orgId).limit(1);
  if (div?.length) return { ok: false, error: t("roster.team.useEnrollment") };
  const { data, error } = await db
    .from("team_memberships")
    .insert({
      org_id: me.orgId,
      team_id: p.data.teamId,
      athlete_id: p.data.athleteId,
      jersey_number: p.data.jerseyNumber,
      position: p.data.position,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) {
    const key = rosterErrorKey(error?.message);
    if (key === "media.roster.errors.generic") logError("assignToTeam", error);
    return { ok: false, error: t.dynamic(key) };
  }
  await writeAudit(me, "roster.assign", "team_memberships", data.id, {
    team_id: p.data.teamId,
    athlete_id: p.data.athleteId,
    jersey_number: p.data.jerseyNumber,
  });
  revalidateRoster(p.data.athleteId, [p.data.teamId]);
  return { ok: true, message: t("media.roster.added", { team: team.name }), data: { membershipId: data.id } };
}

/** Change jersey number / position of one membership. */
export async function updateMembership(input: UpdateMembershipInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("media.errors.forbidden") };
  const p = updateMembershipSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(rosterIssueKey(p.error)) };
  const m = await loadMembership(p.data.membershipId, me.orgId);
  if (!m) return { ok: false, error: t("media.roster.errors.notFound") };
  const db = await sportsDb();
  const { error } = await db
    .from("team_memberships")
    .update({ jersey_number: p.data.jerseyNumber, position: p.data.position })
    .eq("id", m.id)
    .eq("org_id", me.orgId);
  if (error) {
    const key = rosterErrorKey(error.message);
    if (key === "media.roster.errors.generic") logError("updateMembership", error);
    return { ok: false, error: t.dynamic(key) };
  }
  await writeAudit(me, "roster.update", "team_memberships", m.id, {
    jersey_number: p.data.jerseyNumber,
    previous_jersey_number: m.jersey_number,
  });
  revalidateRoster(m.athlete_id, [m.team_id]);
  return { ok: true, message: t("media.roster.updated") };
}

/**
 * Move a player to another team: one UPDATE of team_id, so the player is
 * never on both or neither. Jersey number and position travel with them
 * (a clash on the new team is reported, nothing changes).
 */
export async function moveMembership(input: MoveMembershipInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("media.errors.forbidden") };
  const p = moveMembershipSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(rosterIssueKey(p.error)) };
  const m = await loadMembership(p.data.membershipId, me.orgId);
  if (!m) return { ok: false, error: t("media.roster.errors.notFound") };
  if (m.team_id === p.data.toTeamId) return { ok: true, message: t("media.roster.updated") };
  const team = await teamInOrg(p.data.toTeamId, me.orgId);
  if (!team) return { ok: false, error: t("media.roster.errors.teamNotFound") };
  const db = await sportsDb();
  const { error } = await db
    .from("team_memberships")
    .update({ team_id: p.data.toTeamId, joined_on: new Date().toISOString().slice(0, 10), left_on: null })
    .eq("id", m.id)
    .eq("org_id", me.orgId);
  if (error) {
    const key = rosterErrorKey(error.message);
    if (key === "media.roster.errors.generic") logError("moveMembership", error);
    return { ok: false, error: t.dynamic(key) };
  }
  await writeAudit(me, "roster.move", "team_memberships", m.id, {
    athlete_id: m.athlete_id,
    from_team_id: m.team_id,
    to_team_id: p.data.toTeamId,
  });
  revalidateRoster(m.athlete_id, [m.team_id, p.data.toTeamId]);
  return { ok: true, message: t("media.roster.moved", { team: team.name }) };
}

/** Take a player off a team. */
export async function removeMembership(membershipId: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("media.errors.forbidden") };
  const p = removeMembershipSchema.safeParse({ membershipId });
  if (!p.success) return { ok: false, error: t.dynamic(rosterIssueKey(p.error)) };
  const m = await loadMembership(p.data.membershipId, me.orgId);
  if (!m) return { ok: false, error: t("media.roster.errors.notFound") };
  const db = await sportsDb();
  const { error } = await db.from("team_memberships").delete().eq("id", m.id).eq("org_id", me.orgId);
  if (error) {
    const key = rosterErrorKey(error.message);
    if (key === "media.roster.errors.generic") logError("removeMembership", error);
    return { ok: false, error: t.dynamic(key) };
  }
  await writeAudit(me, "roster.remove", "team_memberships", m.id, { athlete_id: m.athlete_id, team_id: m.team_id });
  revalidateRoster(m.athlete_id, [m.team_id]);
  return { ok: true, message: t("media.roster.removed") };
}

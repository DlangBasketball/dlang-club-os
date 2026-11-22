"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, type ActionResult } from "@/lib/people/server";
import { confirmationMatches } from "@/lib/people/person-delete";
import { revalidateTeamsEverywhere } from "@/lib/people/revalidate";
import { logError } from "@/lib/log";
import { sportsDb } from "@/lib/sportsops/db";
import { parseTeamImpact, teamErrorKey, type TeamImpact } from "@/lib/teams/team-delete";

/**
 * Archive / delete / restore a team (admin only; finance, coaches and parents
 * cannot). The database checks the role and the club again and does each
 * change in one transaction (public.delete_team, migration
 * 20250420102700_team_delete.sql); these actions add the typed-name check of
 * a permanent delete and refresh every portal.
 */

const uuid = z.string().uuid();
type RpcClient = Awaited<ReturnType<typeof createClient>>;

async function rpc(db: RpcClient, fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  const call = db.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  return call(fn, args);
}

export async function previewTeamDelete(teamId: string): Promise<ActionResult<TeamImpact>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("teamAdmin.errors.forbidden") };
  if (!uuid.safeParse(teamId).success) return { ok: false, error: t("teamAdmin.errors.notFound") };
  const db = await createClient();
  const { data, error } = await rpc(db, "preview_delete_team", { p_team: teamId });
  if (error) {
    logError("teamDelete.preview", error);
    return { ok: false, error: t.dynamic(teamErrorKey(error.message), undefined, t("teamAdmin.errors.failed")) };
  }
  const impact = parseTeamImpact(data);
  return impact ? { ok: true, data: impact } : { ok: false, error: t("teamAdmin.errors.failed") };
}

const deleteSchema = z.object({
  teamId: uuid,
  mode: z.enum(["archive", "delete"]).default("archive"),
  confirmName: z.string().max(300).optional(),
});

/** Archive (restorable) or delete permanently (typed team name required). */
export async function deleteTeam(input: z.input<typeof deleteSchema>): Promise<ActionResult<TeamImpact>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("teamAdmin.errors.forbidden") };
  const p = deleteSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("teamAdmin.errors.notFound") };
  const db = await createClient();
  if (p.data.mode === "delete") {
    const { data: team } = await (await sportsDb()).from("teams").select("name").eq("id", p.data.teamId).eq("org_id", me.orgId).maybeSingle();
    if (!team) return { ok: false, error: t("teamAdmin.errors.notFound") };
    if (!confirmationMatches(p.data.confirmName ?? "", team.name)) return { ok: false, error: t("teamAdmin.errors.confirmMismatch") };
  }
  const { data, error } = await rpc(db, "delete_team", { p_team: p.data.teamId, p_mode: p.data.mode });
  if (error) {
    logError("teamDelete.delete", error, { mode: p.data.mode });
    return { ok: false, error: t.dynamic(teamErrorKey(error.message), undefined, t("teamAdmin.errors.failed")) };
  }
  revalidateTeamsEverywhere(me.orgId);
  return {
    ok: true,
    message: p.data.mode === "delete" ? t("teamAdmin.delete.doneDeleted") : t("teamAdmin.delete.doneArchived"),
    data: parseTeamImpact(data) ?? undefined,
  };
}

/** Put an archived team back (active again, in every picker). */
export async function restoreTeam(teamId: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("teamAdmin.errors.forbidden") };
  if (!uuid.safeParse(teamId).success) return { ok: false, error: t("teamAdmin.errors.notFound") };
  const db = await createClient();
  const { error } = await rpc(db, "restore_team", { p_team: teamId });
  if (error) {
    logError("teamDelete.restore", error);
    return { ok: false, error: t.dynamic(teamErrorKey(error.message), undefined, t("teamAdmin.errors.failed")) };
  }
  revalidateTeamsEverywhere(me.orgId);
  return { ok: true, message: t("teamAdmin.delete.doneRestored") };
}

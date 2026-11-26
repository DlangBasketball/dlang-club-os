"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { campsDb } from "@/lib/camps/db";
import { campErrorKey } from "@/lib/camps/validation";
import { CAMP_SEASONS, nextYearName, nextYearSlug, planSeasonSplit, seasonKey } from "@/lib/camps/seasons";
import { notifyWebsite } from "@/lib/website/webhooks";

/**
 * Camp seasons admin: set a camp's season, move a week to another camp,
 * split a camp by season, duplicate a camp for next year. Admin of the
 * current club only; the org comes from the session and the RPCs re-check it
 * (current_org_id() + is_admin()) and write the audit_logs rows.
 */
export type SeasonActionResult = { ok: true; id?: string; created?: number; moved?: number } | { ok: false; error: string };

const uuid = z.string().uuid();

async function requireAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return me as typeof me & { orgId: string };
}

async function fail(key: string, orgId?: string | null): Promise<SeasonActionResult> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("camps.errors.generic")) };
}

function revalidateCamps(...programIds: (string | null | undefined)[]) {
  revalidatePath("/admin/programs");
  for (const id of programIds) if (id) revalidatePath(`/admin/programs/${id}`);
  revalidatePath("/register", "layout");
  revalidatePath("/parent/camps", "layout");
}

async function campRow(programId: string, orgId: string) {
  if (!uuid.safeParse(programId).success) return null;
  const db = await campsDb();
  const { data } = await db.from("programs").select("id,name,slug,season,season_year").eq("id", programId).eq("org_id", orgId).eq("kind", "camp").maybeSingle();
  return data;
}

const seasonInput = z.object({
  season: z.union([z.literal(""), z.enum(CAMP_SEASONS)]),
  year: z.union([z.literal(""), z.null(), z.coerce.number().int("camps.errors.seasonYear").min(2000, "camps.errors.seasonYear").max(2100, "camps.errors.seasonYear")]).optional(),
});

/** Sets (or clears = derive from the weeks) a camp's season and year. */
export async function setCampSeason(programId: string, input: z.input<typeof seasonInput>): Promise<SeasonActionResult> {
  await assertFeature("camp_basket");
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!(await campRow(programId, me.orgId))) return fail("camps.errors.notFound", me.orgId);
  const p = seasonInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "camps.errors.invalidRequest", me.orgId);
  const season = p.data.season || null;
  const year = season && typeof p.data.year === "number" ? p.data.year : null;
  const db = await campsDb();
  const { data, error } = await db.from("programs").update({ season, season_year: year }).eq("id", programId).eq("org_id", me.orgId).select("id");
  if (error) return fail(campErrorKey(error.message), me.orgId);
  if (!data?.length) return fail("camps.errors.notFound", me.orgId);
  revalidateCamps(programId);
  notifyWebsite(me.orgId, "camps", "programs");
  return { ok: true, id: programId };
}

/**
 * Moves a week to another camp of the club. A week with registrations moves
 * only when the admin confirmed it (they move with it).
 */
export async function moveCampEdition(editionId: string, targetProgramId: string, moveRegistrations: boolean): Promise<SeasonActionResult> {
  await assertFeature("camp_basket");
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!uuid.safeParse(editionId).success || !uuid.safeParse(targetProgramId).success) return fail("camps.errors.invalidRequest", me.orgId);
  const db = await campsDb();
  const { data: e } = await db.from("camp_editions").select("id,program_id").eq("id", editionId).eq("org_id", me.orgId).maybeSingle();
  if (!e) return fail("camps.errors.notFound", me.orgId);
  if (!(await campRow(targetProgramId, me.orgId))) return fail("camps.errors.notFound", me.orgId);
  const { data, error } = await db.rpc("move_camp_edition", { p_edition: editionId, p_target: targetProgramId, p_move_registrations: !!moveRegistrations });
  if (error) return fail(campErrorKey(error.message), me.orgId);
  const r = (data ?? {}) as { registrations?: number };
  revalidateCamps(e.program_id, targetProgramId);
  notifyWebsite(me.orgId, "camps", "programs");
  revalidatePath(`/admin/programs/${targetProgramId}/editions/${editionId}`);
  return { ok: true, id: targetProgramId, moved: r.registrations ?? 0 };
}

/** One camp per season of its weeks (names in the club's language). */
export async function splitCampBySeason(programId: string): Promise<SeasonActionResult> {
  await assertFeature("camp_basket");
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  const camp = await campRow(programId, me.orgId);
  if (!camp) return fail("camps.errors.notFound", me.orgId);
  const db = await campsDb();
  const { data: eds } = await db.from("camp_editions").select("id,starts_on").eq("program_id", programId).eq("org_id", me.orgId);
  const plan = planSeasonSplit((eds ?? []).map((e) => ({ id: e.id, startsOn: e.starts_on })));
  if (!plan) return fail("camps.errors.db.NOTHING_TO_SPLIT", me.orgId);
  const t = await getTranslations(me.orgId);
  const names: Record<string, string> = {};
  for (const g of [plan.keep, ...plan.create]) {
    names[seasonKey(g)] = t.dynamic(`camps.seasons.campNames.${g.season}`, { year: g.year }, camp.name);
  }
  const { data, error } = await db.rpc("split_camp_by_season", { p_program: programId, p_names: names });
  if (error) return fail(campErrorKey(error.message), me.orgId);
  const created = ((data ?? {}) as { created?: { program_id: string }[] }).created ?? [];
  revalidateCamps(programId, ...created.map((c) => c.program_id));
  notifyWebsite(me.orgId, "camps", "programs");
  return { ok: true, id: programId, created: created.length };
}

/** A draft copy of the camp with every week 52 weeks later (same weekdays). */
export async function duplicateCampForNextYear(programId: string): Promise<SeasonActionResult> {
  await assertFeature("camp_basket");
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  const camp = await campRow(programId, me.orgId);
  if (!camp) return fail("camps.errors.notFound", me.orgId);
  const year = (camp.season_year ?? new Date().getUTCFullYear()) + 1;
  const db = await campsDb();
  const { data, error } = await db.rpc("duplicate_camp_next_year", {
    p_program: programId, p_name: nextYearName(camp.name), p_slug: nextYearSlug(camp.slug, year), p_shift_days: 364,
  });
  if (error) return fail(campErrorKey(error.message), me.orgId);
  const id = ((data ?? {}) as { program_id?: string }).program_id;
  revalidateCamps(programId, id);
  notifyWebsite(me.orgId, "camps", "programs");
  return { ok: true, id };
}

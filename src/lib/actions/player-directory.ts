"use server";

import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import { HIDDEN_ATHLETE_STATUS_FILTER } from "@/lib/people/person-delete";
import { asBillingClient } from "@/lib/people/billing-athletes";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import { athleteSchema, familySchema } from "@/lib/people/validation";
import { getMembershipFormPlayer, type MembershipFormPlayer } from "@/lib/data/player-billing";

/*
 * Player / payer directory for the billing screens (club membership form,
 * record a payment). Same search as the selection roster directory (name
 * words or a birth year), without the selection feature gate: admin and
 * finance search, only an admin creates a player — and only after the
 * search found nobody (the form shows the matches first, so no duplicate).
 * The org is always the caller's; nothing is read across clubs.
 */
type Me = SessionUser & { orgId: string };
async function staff(roles: ("admin" | "finance")[]): Promise<Me | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return null;
  return me as Me;
}

export type DirectoryResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type PlayerHit = { id: string; name: string; dob: string | null; familyId: string; familyName: string | null; status: string };

const query = z.string().trim().min(1).max(80);

/** Find players by name words or birth year (admin / finance). */
export async function searchPlayers(input: string): Promise<DirectoryResult<PlayerHit[]>> {
  const t = await getTranslations();
  const me = await staff(["admin", "finance"]);
  if (!me) return { ok: false, error: t("billing.errors.NOT_AUTHORIZED") };
  const q = query.safeParse(input);
  if (!q.success) return { ok: true, data: [] };
  const db = await createClient();
  const year = /^\d{4}$/.test(q.data) ? Number(q.data) : null;
  if (!me.roles.includes("admin")) {
    // Finance (20250420106300): names, family and status through billing_athletes;
    // no DOB, so no birth-year search.
    if (year) return { ok: true, data: [] };
    let breq = asBillingClient(db).from("billing_athletes").select("id,first_name,last_name,status,family_id")
      .eq("org_id", me.orgId).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER);
    for (const w of q.data.replace(/[%,()*\\]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3)) breq = breq.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`);
    const { data: rows, error: bErr } = await breq.order("last_name").order("first_name").limit(20);
    if (bErr) {
      logError("playerDirectory.search", bErr.message);
      return { ok: false, error: t("playerBilling.errors.searchFailed") };
    }
    const famIds = Array.from(new Set((rows ?? []).map((a) => a.family_id)));
    const { data: fams } = famIds.length ? await db.from("families").select("id,name").eq("org_id", me.orgId).in("id", famIds) : { data: [] };
    const famName = new Map((fams ?? []).map((f) => [f.id, f.name]));
    return {
      ok: true,
      data: (rows ?? []).map((a) => ({
        id: a.id, name: `${a.first_name} ${a.last_name}`.trim(), dob: null, status: a.status, familyId: a.family_id, familyName: famName.get(a.family_id) ?? null,
      })),
    };
  }
  let req = db.from("athletes").select("id,first_name,last_name,dob,status,family_id,families(name)")
    .eq("org_id", me.orgId).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER);
  if (year) req = req.gte("dob", `${year}-01-01`).lte("dob", `${year}-12-31`);
  else for (const w of q.data.replace(/[%,()*\\]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3)) req = req.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`);
  const { data, error } = await req.order("last_name").order("first_name").limit(20);
  if (error) {
    logError("playerDirectory.search", error.message);
    return { ok: false, error: t("playerBilling.errors.searchFailed") };
  }
  type A = { id: string; first_name: string; last_name: string; dob: string | null; status: string; family_id: string; families: { name: string } | { name: string }[] | null };
  return {
    ok: true,
    data: ((data ?? []) as unknown as A[]).map((a) => ({
      id: a.id, name: `${a.first_name} ${a.last_name}`.trim(), dob: a.dob, status: a.status, familyId: a.family_id,
      familyName: Array.isArray(a.families) ? a.families[0]?.name ?? null : a.families?.name ?? null,
    })),
  };
}

export type PayerHit = { familyId: string; familyName: string; contactName: string | null; players: string[] };

/** Find a payer (family) by family name, contact name or one of its players (admin / finance). */
export async function searchPayers(input: string): Promise<DirectoryResult<PayerHit[]>> {
  const t = await getTranslations();
  const me = await staff(["admin", "finance"]);
  if (!me) return { ok: false, error: t("billing.errors.NOT_AUTHORIZED") };
  const q = query.safeParse(input);
  if (!q.success) return { ok: true, data: [] };
  const term = q.data.replace(/[%,()*\\]/g, " ").trim();
  if (!term) return { ok: true, data: [] };
  const db = await createClient();
  const [fams, players] = await Promise.all([
    db.from("families").select("id,name,contact_name").eq("org_id", me.orgId).or(`name.ilike.%${term}%,contact_name.ilike.%${term}%`).limit(15),
    searchPlayers(term),
  ]);
  if (fams.error) return { ok: false, error: t("playerBilling.errors.searchFailed") };
  const byId = new Map<string, PayerHit>();
  for (const f of fams.data ?? []) byId.set(f.id, { familyId: f.id, familyName: f.name, contactName: f.contact_name, players: [] });
  const playerHits = players.ok ? players.data : [];
  const missing = playerHits.filter((p) => !byId.has(p.familyId)).map((p) => p.familyId);
  if (missing.length) {
    const { data } = await db.from("families").select("id,name,contact_name").eq("org_id", me.orgId).in("id", Array.from(new Set(missing)));
    for (const f of data ?? []) byId.set(f.id, { familyId: f.id, familyName: f.name, contactName: f.contact_name, players: [] });
  }
  for (const p of playerHits) byId.get(p.familyId)?.players.push(p.name);
  return { ok: true, data: Array.from(byId.values()).slice(0, 20) };
}

/** Family, guardians, teams and existing season memberships of a chosen player (membership form). */
export async function loadMembershipPlayer(athleteId: string): Promise<DirectoryResult<MembershipFormPlayer | null>> {
  const t = await getTranslations();
  if (!(await staff(["admin", "finance"]))) return { ok: false, error: t("billing.errors.NOT_AUTHORIZED") };
  if (!z.string().uuid().safeParse(athleteId).success) return { ok: true, data: null };
  const r = await getMembershipFormPlayer(athleteId);
  if (r.error !== null) return { ok: false, error: t("playerBilling.errors.loadFailed") };
  return { ok: true, data: r.data };
}

const newPlayerSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guardianName: z.string().trim().min(1).max(120),
  guardianEmail: z.string().trim().max(200).optional().default(""),
  guardianPhone: z.string().trim().max(40).optional().default(""),
});
export type NewPlayerInput = z.input<typeof newPlayerSchema>;

/**
 * Create a player (and a family with the guardian as billing contact) when
 * the search found nobody. Admin only. Refuses an exact duplicate (same
 * first name, last name and date of birth in the club).
 */
export async function createPlayer(input: NewPlayerInput): Promise<DirectoryResult<PlayerHit>> {
  const t = await getTranslations();
  const me = await staff(["admin"]);
  if (!me) return { ok: false, error: t("billing.errors.NOT_AUTHORIZED") };
  const p = newPlayerSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("playerBilling.errors.newPlayerInvalid") };
  const v = p.data;
  const db = await createClient();
  const { data: dup } = await db.from("athletes").select("id").eq("org_id", me.orgId).ilike("first_name", v.firstName)
    .ilike("last_name", v.lastName).eq("dob", v.dob).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).limit(1);
  if ((dup ?? []).length) return { ok: false, error: t("playerBilling.errors.duplicatePlayer") };
  const f = familySchema.safeParse({
    name: t("roster.add.familyName", { name: v.lastName }), contactName: v.guardianName,
    contactEmail: v.guardianEmail || null, phone: v.guardianPhone || null,
  });
  if (!f.success) return { ok: false, error: t("roster.errors.guardianEmail") };
  const { data: fam, error: fErr } = await db.from("families").insert({
    org_id: me.orgId, name: f.data.name, contact_name: f.data.contactName, contact_email: f.data.contactEmail, phone: f.data.phone,
  }).select("id,name").single();
  if (fErr || !fam) {
    logError("playerDirectory.family", fErr?.message ?? "no row");
    return { ok: false, error: t("playerBilling.errors.saveFailed") };
  }
  const a = athleteSchema.safeParse({ familyId: fam.id, firstName: v.firstName, lastName: v.lastName, dob: v.dob });
  if (!a.success) return { ok: false, error: t("playerBilling.errors.newPlayerInvalid") };
  const { data: ath, error } = await db.from("athletes").insert({
    org_id: me.orgId, family_id: a.data.familyId, first_name: a.data.firstName, last_name: a.data.lastName, dob: a.data.dob, status: "active",
  }).select("id,first_name,last_name,dob,status").single();
  if (error || !ath) {
    logError("playerDirectory.athlete", error?.message ?? "no row");
    return { ok: false, error: t("playerBilling.errors.saveFailed") };
  }
  revalidatePersonEverywhere(me.orgId);
  return { ok: true, data: { id: ath.id, name: `${ath.first_name} ${ath.last_name}`.trim(), dob: ath.dob, status: ath.status, familyId: fam.id, familyName: fam.name } };
}

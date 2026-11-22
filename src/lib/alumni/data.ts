import "server-only";
import { cache } from "react";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { hasFeature } from "@/lib/upgrades/server";
import { clubMediaPublicUrl, isLibraryPath } from "@/lib/media/cover";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { alumniAdminDb, alumniDb, type AlumniContactRow, type AlumniPlacementRow, type AlumniRow } from "./db";
import { COUNT_GROUPS, currentPlacement, type AlumniListItem, type CountGroup } from "./rules";

export const ALUMNI_FEATURE = "alumni_network";
export type AlumniApp = "admin" | "coach";
export const ALUMNI_BASE: Record<AlumniApp, string> = { admin: "/admin/alumni", coach: "/coach/alumni" };

type Me = SessionUser & { orgId: string };

/**
 * May the signed-in user work with alumni? Admins of the club, and coaches
 * the admin gave alumni access (alumni_staff_can() in SQL decides; finance
 * and parents never). Also requires the club's alumni_network feature.
 */
export const getAlumniAccess = cache(async (): Promise<{ me: Me; isAdmin: boolean } | null> => {
  const me = await getSessionUser();
  if (!me?.orgId) return null;
  if (!me.roles.includes("admin") && !me.roles.includes("coach")) return null;
  if (!(await hasFeature(me.orgId, ALUMNI_FEATURE))) return null;
  const db = await alumniDb();
  const { data, error } = await db.rpc("alumni_staff_can");
  if (error) {
    logError("alumni.access", error);
    return null;
  }
  return data ? { me: me as Me, isAdmin: me.roles.includes("admin") } : null;
});

/** Coach nav: hide the alumni entry for coaches without access. */
export async function alumniHiddenHrefs(user: SessionUser): Promise<string[]> {
  if (!user.orgId || user.roles.includes("admin")) return [];
  return (await getAlumniAccess()) ? [] : [ALUMNI_BASE.coach];
}

export type AlumniListRow = AlumniListItem & {
  current: AlumniPlacementRow | null;
  showcase_consent: boolean;
  contact_consent: boolean;
  last_contact_at: string | null;
};

const LIST_COLS = "id,first_name,last_name,email,phone,status,tags,birth_year,showcase_consent,contact_consent,created_at";

/** Every alumnus of the club with placements, next open follow-up and last contact (RLS). */
export async function listAlumni(orgId: string): Promise<AlumniListRow[]> {
  const db = await alumniDb();
  const [{ data: people, error }, { data: pls }, { data: contacts }] = await Promise.all([
    db.from("alumni").select(LIST_COLS).eq("org_id", orgId).order("last_name").order("first_name").limit(5000),
    db.from("alumni_placements").select("*").eq("org_id", orgId).limit(20000),
    db.from("alumni_contacts").select("alumni_id,happened_at,follow_up_on,follow_up_done").eq("org_id", orgId).order("happened_at", { ascending: false }).limit(20000),
  ]);
  if (error) {
    logError("alumni.list", error);
    return [];
  }
  const byPerson = new Map<string, AlumniPlacementRow[]>();
  for (const p of (pls ?? []) as AlumniPlacementRow[]) byPerson.set(p.alumni_id, [...(byPerson.get(p.alumni_id) ?? []), p]);
  const follow = new Map<string, string>();
  const last = new Map<string, string>();
  for (const c of (contacts ?? []) as Pick<AlumniContactRow, "alumni_id" | "happened_at" | "follow_up_on" | "follow_up_done">[]) {
    if (!last.has(c.alumni_id)) last.set(c.alumni_id, c.happened_at);
    if (c.follow_up_on && !c.follow_up_done) {
      const cur = follow.get(c.alumni_id);
      if (!cur || c.follow_up_on < cur) follow.set(c.alumni_id, c.follow_up_on);
    }
  }
  return ((people ?? []) as unknown as AlumniRow[]).map((a) => {
    const placements = byPerson.get(a.id) ?? [];
    return {
      id: a.id, first_name: a.first_name, last_name: a.last_name, email: a.email, phone: a.phone, status: a.status, tags: a.tags,
      birth_year: a.birth_year, placements, current: currentPlacement(placements), follow_up_on: follow.get(a.id) ?? null,
      showcase_consent: a.showcase_consent, contact_consent: a.contact_consent, last_contact_at: last.get(a.id) ?? null,
    };
  });
}

export type AlumniContactView = AlumniContactRow & { by_name: string | null };
export type AlumniDetail = {
  alumni: AlumniRow;
  photoUrl: string | null;
  placements: AlumniPlacementRow[];
  contacts: AlumniContactView[];
  athlete: { id: string; name: string; archived: boolean } | null;
};

export async function getAlumniDetail(orgId: string, id: string): Promise<AlumniDetail | null> {
  const db = await alumniDb();
  const { data: a } = await db.from("alumni").select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (!a) return null;
  const alumni = a as AlumniRow;
  const [{ data: pls }, { data: cs }] = await Promise.all([
    db.from("alumni_placements").select("*").eq("alumni_id", id).eq("org_id", orgId),
    db.from("alumni_contacts").select("*").eq("alumni_id", id).eq("org_id", orgId).order("happened_at", { ascending: false }).limit(500),
  ]);
  const contacts = (cs ?? []) as AlumniContactRow[];
  // Author names: staff profiles of this club only (service role, org-filtered).
  const admin = alumniAdminDb();
  const authorIds = Array.from(new Set(contacts.map((c) => c.by_user).filter((x): x is string => !!x)));
  const names = new Map<string, string>();
  if (authorIds.length) {
    const { data: profs } = await admin.from("profiles").select("id,full_name,email").in("id", authorIds).eq("org_id", orgId);
    for (const p of profs ?? []) names.set(p.id, p.full_name || p.email);
  }
  let athlete: AlumniDetail["athlete"] = null;
  if (alumni.athlete_id) {
    const { data: ath } = await admin.from("athletes").select("id,first_name,last_name,status").eq("id", alumni.athlete_id).eq("org_id", orgId).maybeSingle();
    if (ath && ath.status !== "erased") athlete = { id: ath.id, name: `${ath.first_name} ${ath.last_name}`, archived: ath.status === "archived" };
  }
  const placements = ((pls ?? []) as AlumniPlacementRow[]).sort((x, y) =>
    (y.start_date ?? `${y.end_year ?? ""}`).localeCompare(x.start_date ?? `${x.end_year ?? ""}`) || y.created_at.localeCompare(x.created_at));
  return {
    alumni,
    photoUrl: alumni.photo_path && isLibraryPath(alumni.photo_path, orgId) ? clubMediaPublicUrl(alumni.photo_path) : null,
    placements,
    contacts: contacts.map((c) => ({ ...c, by_name: c.by_user ? names.get(c.by_user) ?? null : null })),
    athlete,
  };
}

/** Coaches of the club with a login, and whether they have alumni access (admins only; RLS). */
export async function listCoachAccess(orgId: string): Promise<{ id: string; name: string; access: boolean }[]> {
  const db = await alumniDb();
  const { data } = await db.from("coaches").select("id,display_name,profile_id,is_active,alumni_access").eq("org_id", orgId).eq("is_active", true).order("display_name");
  return ((data ?? []) as { id: string; display_name: string; profile_id: string | null; alumni_access: boolean }[])
    .filter((c) => c.profile_id)
    .map((c) => ({ id: c.id, name: c.display_name, access: Boolean(c.alumni_access) }));
}

/** Club media library images that can be used as a profile photo. */
export async function listPhotoOptions(orgId: string): Promise<{ path: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("media_assets").select("path,alt_text").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200);
  return (data ?? []).filter((m) => isLibraryPath(m.path, orgId)).map((m) => ({ path: m.path, label: m.alt_text || m.path.split("/").pop() || m.path }));
}

export type PlacementStats = {
  total: number;
  groups: { key: CountGroup; count: number }[];
  newThisSeason: number;
  seasonName: string | null;
  followUpsDue: number;
};

/** Dashboard card: people per current placement type, new placements this season, follow-ups due. */
export async function getPlacementStats(orgId: string, today = new Date().toISOString().slice(0, 10)): Promise<PlacementStats> {
  const db = await alumniDb();
  const rows = await listAlumni(orgId);
  const { data: season } = await db.from("seasons").select("name,starts_on").eq("org_id", orgId).eq("is_current", true).maybeSingle();
  const since = (season as { starts_on: string } | null)?.starts_on
    ?? new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 864e5).toISOString().slice(0, 10);
  const groups = new Map<string, number>();
  let newThisSeason = 0;
  for (const r of rows) {
    if (r.current) {
      const g = COUNT_GROUPS.find((x) => (x.types as readonly string[]).includes(r.current!.institution_type));
      if (g) groups.set(g.key, (groups.get(g.key) ?? 0) + 1);
    }
    for (const p of r.placements) {
      const started = p.start_date ?? p.created_at.slice(0, 10);
      if (started >= since && started <= today) newThisSeason += 1;
    }
  }
  return {
    total: rows.length,
    groups: COUNT_GROUPS.map((g) => ({ key: g.key, count: groups.get(g.key) ?? 0 })).filter((g) => g.count > 0),
    newThisSeason,
    seasonName: (season as { name: string } | null)?.name ?? null,
    followUpsDue: rows.filter((r) => r.follow_up_on && r.follow_up_on <= today).length,
  };
}

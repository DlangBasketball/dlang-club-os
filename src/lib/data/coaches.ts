import "server-only";
import { sportsDb } from "@/lib/sportsops/db";
import { signCoachPhotos } from "@/lib/people/server";
import { isPhotoPathFor } from "@/lib/people/validation";
import { parseUsage, type CoachUsage } from "@/lib/coaches/validation";

/**
 * Server-side reads for coach management (/admin/coaches). Every query runs
 * with the signed-in user's client: RLS scopes rows to the caller's org
 * (coaches are visible to org members; invitations and profiles to admins).
 */

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });

export type CoachTeam = { id: string; name: string; role: string; isActive: boolean };

export type CoachListItem = {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  serves: string[];
  isActive: boolean;
  /** A login is linked to this coach row (profiles.id). */
  linked: boolean;
  /** An open invitation exists for this coach (not yet accepted). */
  invitePending: boolean;
  teams: CoachTeam[];
  photoUrl: string | null;
  hasPhoto: boolean;
};

type CoachRow = {
  id: string; org_id: string; profile_id: string | null; display_name: string; role_title: string | null;
  bio: string | null; serves: string[] | null; is_active: boolean; photo_path: string | null;
};

async function hydrate(rows: CoachRow[]): Promise<CoachListItem[]> {
  if (!rows.length) return [];
  const db = await sportsDb();
  const ids = rows.map((r) => r.id);
  const [links, invites, photos] = await Promise.all([
    db.from("team_coaches").select("team_id,coach_id,role").in("coach_id", ids),
    db.from("invitations").select("coach_id").in("coach_id", ids).eq("status", "pending"),
    signCoachPhotos(rows.filter((r) => isPhotoPathFor(r.photo_path, r.org_id, r.id)).map((r) => ({ id: r.id, photoPath: r.photo_path }))),
  ]);
  const teamIds = Array.from(new Set((links.data ?? []).map((l) => l.team_id)));
  const teams = teamIds.length
    ? await db.from("teams").select("id,name,is_active").in("id", teamIds)
    : { data: [] as { id: string; name: string; is_active: boolean }[] };
  const teamById = new Map((teams.data ?? []).map((t) => [t.id, t]));
  const pending = new Set((invites.data ?? []).map((i) => i.coach_id).filter(Boolean) as string[]);

  return rows.map((r) => ({
    id: r.id,
    name: r.display_name,
    title: r.role_title,
    bio: r.bio,
    serves: r.serves ?? [],
    isActive: r.is_active,
    linked: !!r.profile_id,
    invitePending: !r.profile_id && pending.has(r.id),
    teams: (links.data ?? [])
      .filter((l) => l.coach_id === r.id && teamById.has(l.team_id))
      .map((l) => {
        const t = teamById.get(l.team_id)!;
        return { id: t.id, name: t.name, role: l.role, isActive: t.is_active };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    photoUrl: photos.get(r.id) ?? null,
    hasPhoto: !!r.photo_path,
  }));
}

const COLS = "id,org_id,profile_id,display_name,role_title,bio,serves,is_active,photo_path";

export async function listCoaches(): Promise<Result<CoachListItem[]>> {
  const db = await sportsDb();
  const { data, error } = await db.from("coaches").select(COLS).order("display_name");
  if (error) return fail(error.message);
  return ok(await hydrate((data ?? []) as CoachRow[]));
}

export type CoachDetail = CoachListItem & {
  orgId: string;
  usage: CoachUsage;
  loginEmail: string | null;
};

export async function getCoach(id: string): Promise<Result<CoachDetail | null>> {
  const db = await sportsDb();
  const { data, error } = await db.from("coaches").select(COLS).eq("id", id).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return ok(null);
  const row = data as CoachRow;
  const [items, usage, profile] = await Promise.all([
    hydrate([row]),
    db.rpc("coach_usage", { p_coach: id }),
    row.profile_id
      ? db.from("profiles").select("email").eq("id", row.profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return ok({
    ...items[0],
    orgId: row.org_id,
    usage: parseUsage(usage.data),
    loginEmail: ((profile as { data: { email?: string } | null }).data?.email as string | undefined) ?? null,
  });
}

/** Training services the coach can be marked as offering (player development). */
export async function listServiceOptions(): Promise<{ slug: string; name: string }[]> {
  const db = await sportsDb();
  const { data } = await db.from("training_services").select("slug,name,is_active").order("name");
  return (data ?? []).map((s) => ({ slug: s.slug, name: s.name }));
}

/** Coaches without a login yet (invitation picker). */
export async function listUnlinkedCoaches(): Promise<{ id: string; name: string }[]> {
  const db = await sportsDb();
  const { data } = await db.from("coaches").select("id,display_name").is("profile_id", null).eq("is_active", true).order("display_name");
  return (data ?? []).map((c) => ({ id: c.id, name: c.display_name }));
}

/** The signed-in user's own coach row (coach app header). */
export async function getMyCoachPhoto(userId: string): Promise<{ id: string; name: string; photoUrl: string | null } | null> {
  const db = await sportsDb();
  const { data } = await db.from("coaches").select("id,org_id,display_name,photo_path").eq("profile_id", userId).maybeSingle();
  if (!data) return null;
  const photos = isPhotoPathFor(data.photo_path, data.org_id, data.id)
    ? await signCoachPhotos([{ id: data.id, photoPath: data.photo_path }])
    : new Map<string, string>();
  return { id: data.id, name: data.display_name, photoUrl: photos.get(data.id) ?? null };
}

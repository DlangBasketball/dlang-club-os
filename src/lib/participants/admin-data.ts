import "server-only";
import { logError } from "@/lib/log";
import { participantsDb } from "./db";

/*
 * Staff reads of the athlete data checks, merge candidates and profile history
 * (migration 20250420106200). Every RPC is admin-only and scoped to the
 * session's club in SQL; a non-admin gets null / [].
 */

export type MergeCard = {
  id: string; firstName: string; lastName: string; dob: string | null; gender: string | null; status: string; createdAt: string;
  familyId: string | null; familyName: string | null; hasLogin: boolean; teams: number; registrations: number; invoices: number;
};
export type DuplicatePair = { flagId: string; createdAt: string; athlete: MergeCard; match: MergeCard };

function card(r: Record<string, unknown>): MergeCard {
  return {
    id: String(r.id), firstName: String(r.first_name ?? ""), lastName: String(r.last_name ?? ""), dob: (r.dob as string | null) ?? null,
    gender: (r.gender as string | null) ?? null, status: String(r.status ?? ""), createdAt: String(r.created_at ?? ""),
    familyId: (r.family_id as string | null) ?? null, familyName: (r.family_name as string | null) ?? null, hasLogin: r.has_login === true,
    teams: Number(r.teams ?? 0), registrations: Number(r.registrations ?? 0), invoices: Number(r.invoices ?? 0),
  };
}

/** Open POSSIBLE_DUPLICATE findings with both records (admin). */
export async function getDuplicatePairs(): Promise<DuplicatePair[]> {
  const db = await participantsDb();
  const { data, error } = await db.rpc("athlete_duplicate_pairs", {});
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((p) => ({
    flagId: String(p.flag_id), createdAt: String(p.created_at ?? ""),
    athlete: card(p.athlete as Record<string, unknown>), match: card(p.match as Record<string, unknown>),
  }));
}

export type SelfLinkFinding = { flagId: string; athleteId: string; athleteName: string; profileName: string | null; profileEmail: string | null; createdAt: string };

/** Open POSSIBLE_SELF_LINK findings (admin; RLS: data_review_flags / athletes / profiles of the club). */
export async function getSelfLinkFindings(): Promise<SelfLinkFinding[]> {
  const db = await participantsDb();
  const { data: flags, error } = await db.from("data_review_flags").select("id,details,created_at")
    .eq("reason_code", "POSSIBLE_SELF_LINK").is("resolved_at", null).order("created_at").limit(100);
  if (error) {
    logError("participants.selfLinks", error);
    return [];
  }
  const rows = (flags ?? []) as { id: string; details: Record<string, string>; created_at: string }[];
  const athleteIds = rows.map((r) => r.details?.athlete_id).filter(Boolean);
  const profileIds = rows.map((r) => r.details?.profile_id).filter(Boolean);
  if (!rows.length) return [];
  const [{ data: aths }, { data: profs }] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name").in("id", athleteIds),
    db.from("profiles").select("id,full_name,email").in("id", profileIds),
  ]);
  const a = new Map(((aths ?? []) as { id: string; first_name: string; last_name: string }[]).map((x) => [x.id, `${x.first_name} ${x.last_name}`.trim()]));
  const p = new Map(((profs ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((x) => [x.id, x]));
  return rows.filter((r) => a.has(r.details?.athlete_id)).map((r) => ({
    flagId: r.id, athleteId: r.details.athlete_id, athleteName: a.get(r.details.athlete_id) ?? "",
    profileName: p.get(r.details.profile_id)?.full_name ?? null, profileEmail: p.get(r.details.profile_id)?.email ?? null,
    createdAt: r.created_at,
  }));
}

export type ProfileHistoryEntry = {
  id: string; at: string; action: string; actorName: string | null; via: string | null; reason: string | null;
  changes: { field: string; before: unknown; after: unknown }[];
};

/** Profile fields shown in the history (other keys of an audit row are context). */
export const HISTORY_FIELDS = [
  "first_name", "last_name", "dob", "gender", "height_cm", "weight_kg", "position_pref", "jersey_size", "preferred_jersey_number",
  "player_profile_id", "family_id", "status", "merged_into_id", "merged_athlete_id", "kept_athlete_id",
] as const;

/** Before / after per field of one audit row. Exported for tests. */
export function historyChanges(before: Record<string, unknown>, after: Record<string, unknown>): ProfileHistoryEntry["changes"] {
  const keys = HISTORY_FIELDS.filter((k) => k in before || k in after);
  return keys.map((k) => ({ field: k, before: before[k] ?? null, after: after[k] ?? null }))
    .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
}

/** Profile history of an athlete (admin only; null for anyone else). */
export async function getProfileHistory(athleteId: string): Promise<ProfileHistoryEntry[] | null> {
  const db = await participantsDb();
  const { data, error } = await db.rpc("athlete_profile_history", { p_athlete: athleteId });
  if (error) return null;
  return ((data ?? []) as Record<string, unknown>[]).map((e) => ({
    id: String(e.id), at: String(e.at), action: String(e.action), actorName: (e.actor_name as string | null) ?? null,
    via: (e.via as string | null) ?? null, reason: (e.reason as string | null) ?? null,
    changes: historyChanges((e.before ?? {}) as Record<string, unknown>, (e.after ?? {}) as Record<string, unknown>),
  }));
}

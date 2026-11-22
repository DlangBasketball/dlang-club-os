import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sportsDb } from "@/lib/sportsops/db";
import { getAthleteDevelopment } from "@/lib/development/data";
import { getAthleteTraining } from "@/lib/training/data";
import { logError } from "@/lib/log";
import { attendanceStats, seasonStartFor, type MarkRow } from "@/lib/people/player-stats";
import type { TeamPickerOption } from "@/lib/sportsops/roster-validation";

/**
 * Player card (admin / parent / coach profile): teams, quick stats.
 * Every read goes through the signed-in user's client, so RLS decides what a
 * guardian, coach or finance user sees.
 */

export type PlayerTeam = {
  membershipId: string;
  teamId: string;
  teamName: string;
  color: string | null;
  jerseyNumber: number | null;
  position: string | null;
  status: string;
  seasonName: string | null;
  isCurrentSeason: boolean;
};

export async function getPlayerTeams(athleteId: string): Promise<PlayerTeam[]> {
  try {
    const db = await sportsDb();
    const { data: rows } = await db
      .from("team_memberships")
      .select("id,team_id,jersey_number,position,status")
      .eq("athlete_id", athleteId);
    const teamIds = Array.from(new Set((rows ?? []).map((r) => r.team_id)));
    if (!teamIds.length) return [];
    const { data: teams } = await db.from("teams").select("id,name,color,season_id").in("id", teamIds);
    const seasonIds = Array.from(new Set((teams ?? []).map((t) => t.season_id).filter((x): x is string => !!x)));
    const { data: seasons } = seasonIds.length
      ? await db.from("seasons").select("id,name,is_current").in("id", seasonIds)
      : { data: [] as { id: string; name: string; is_current: boolean }[] };
    const tMap = new Map((teams ?? []).map((t) => [t.id, t]));
    const sMap = new Map((seasons ?? []).map((s) => [s.id, s]));
    return (rows ?? [])
      .map((r) => {
        const team = tMap.get(r.team_id);
        const season = team?.season_id ? sMap.get(team.season_id) : undefined;
        return {
          membershipId: r.id,
          teamId: r.team_id,
          teamName: team?.name ?? "",
          color: team?.color ?? null,
          jerseyNumber: r.jersey_number,
          position: r.position,
          status: r.status,
          seasonName: season?.name ?? null,
          isCurrentSeason: !!season?.is_current,
        };
      })
      .filter((t) => t.teamName)
      .sort((a, b) => Number(b.isCurrentSeason) - Number(a.isCurrentSeason) || a.teamName.localeCompare(b.teamName));
  } catch (e) {
    logError("playerProfile.teams", e);
    return [];
  }
}

/** Teams for the "Add to team…" pickers (club staff). */
export async function getTeamPickerOptions(): Promise<TeamPickerOption[]> {
  try {
    const db = await sportsDb();
    const [{ data: teams }, { data: seasons }] = await Promise.all([
      db.from("teams").select("id,name,season_id,is_active,program_id").order("name"),
      db.from("seasons").select("id,name,is_current"),
    ]);
    const sMap = new Map((seasons ?? []).map((s) => [s.id, s]));
    const programIds = Array.from(new Set((teams ?? []).map((t) => t.program_id).filter((x): x is string => !!x)));
    type ProgramLite = { id: string; name: string; kind: string; selection_enabled: boolean | null };
    const { data: programs } = programIds.length
      ? await (db.from("programs") as unknown as { select: (c: string) => { in: (k: string, v: string[]) => Promise<{ data: ProgramLite[] | null }> } })
        .select("id,name,kind,selection_enabled").in("id", programIds)
      : { data: [] as ProgramLite[] };
    const pMap = new Map((programs ?? []).map((p) => [p.id, p]));
    return (teams ?? []).map((t) => {
      const s = t.season_id ? sMap.get(t.season_id) : undefined;
      const p = t.program_id ? pMap.get(t.program_id) : undefined;
      return {
        id: t.id,
        name: t.name,
        seasonId: t.season_id,
        seasonName: s?.name ?? null,
        isCurrentSeason: !!s?.is_current,
        isActive: t.is_active,
        programId: t.program_id,
        programName: p?.name ?? null,
        isSelectionProgram: !!p && (p.kind === "selection" || !!p.selection_enabled),
      };
    });
  } catch (e) {
    logError("playerProfile.teamOptions", e);
    return [];
  }
}

async function currentSeasonStart(): Promise<string | null> {
  try {
    const db = await sportsDb();
    const { data } = await db.from("seasons").select("starts_on").eq("is_current", true).maybeSingle();
    return data?.starts_on ?? null;
  } catch {
    return null;
  }
}

export type PlayerStats = {
  attendanceRate: number | null;
  seasonSessions: number;
  evaluation: { score: number | null; emoji: string | null; date: string | null } | null;
  credits: number | null;
};

/**
 * Quick-stat tiles. `marks` are the attendance rows the caller may see
 * (admin: all; parent: published only). Development and training numbers
 * are best effort: a module the club does not use simply shows a dash.
 */
export async function getPlayerStats(
  athleteId: string,
  marks: MarkRow[],
  opts: { familyView?: boolean; includeCredits?: boolean; includeDevelopment?: boolean } = {},
): Promise<PlayerStats> {
  const today = new Date().toISOString().slice(0, 10);
  const [seasonStart, dev, training] = await Promise.all([
    currentSeasonStart(),
    opts.includeDevelopment === false
      ? Promise.resolve(null)
      : getAthleteDevelopment(athleteId, { familyView: opts.familyView }).catch((e) => {
          logError("playerProfile.development", e);
          return null;
        }),
    opts.includeCredits
      ? getAthleteTraining(athleteId).catch((e) => {
          logError("playerProfile.training", e);
          return null;
        })
      : Promise.resolve(null),
  ]);
  const att = attendanceStats(marks, today, seasonStartFor(today, seasonStart));
  const d = dev && dev.error === null ? dev.data : null;
  const latest = d?.evaluations?.[0] ?? null;
  const evaluation = d
    ? { score: latest?.overallScore ?? d.progressScore ?? null, emoji: d.level?.tier?.emoji ?? null, date: latest?.evaluatedOn ?? null }
    : null;
  const tr = training && training.error === null ? training.data : null;
  const credits = tr ? tr.balances.reduce((sum, b) => sum + (Number(b.remaining) || 0), 0) : null;
  return { attendanceRate: att.rate30, seasonSessions: att.seasonSessions, evaluation, credits };
}

export type PlayerInvoice = { id: string; number: string; status: string; total: number; currency: string; dueDate: string | null; issuedAt: string; forThisPlayer: boolean };

/**
 * Billing tab (admin / finance): the family's latest invoices, those for this
 * player first. Billing only; never medical data.
 */
export async function getPlayerBilling(familyId: string, athleteId: string, limit = 12): Promise<PlayerInvoice[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("invoices")
      .select("id,number,status,total_chf,currency,due_date,issued_at,athlete_id")
      .eq("family_id", familyId)
      .order("issued_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data
      .map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        total: Number(i.total_chf ?? 0),
        currency: i.currency,
        dueDate: i.due_date,
        issuedAt: i.issued_at,
        forThisPlayer: i.athlete_id === athleteId,
      }))
      .sort((a, b) => Number(b.forThisPlayer) - Number(a.forThisPlayer));
  } catch (e) {
    logError("playerProfile.billing", e);
    return [];
  }
}

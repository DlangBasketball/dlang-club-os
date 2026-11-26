import { z } from "zod";
import type { PickerTeam } from "@/lib/teams/programme-teams";

/**
 * Team assignment (roster) validation and pickers: pure helpers shared by
 * the server actions (src/lib/actions/roster.ts) and the client pickers.
 */

export const JERSEY_MAX = 999;
export const POSITION_MAX = 60;

/** "" -> null, "07" -> 7; anything else non-numeric or out of 0..999 -> undefined (invalid). */
export function parseJersey(raw: string | number | null | undefined): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 0 && raw <= JERSEY_MAX ? raw : undefined;
  const s = raw.trim();
  if (s === "") return null;
  if (!/^\d{1,3}$/.test(s)) return undefined;
  const n = Number(s);
  return n <= JERSEY_MAX ? n : undefined;
}

const jersey = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    const n = parseJersey(v ?? null);
    if (n === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "media.roster.errors.jersey" });
      return z.NEVER;
    }
    return n;
  });
const position = z
  .string()
  .trim()
  .max(POSITION_MAX, "media.roster.errors.position")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const assignToTeamSchema = z.object({
  athleteId: z.string().uuid("media.roster.errors.invalid"),
  teamId: z.string().uuid("media.roster.errors.invalid"),
  jerseyNumber: jersey,
  position,
});
export type AssignToTeamInput = z.input<typeof assignToTeamSchema>;

export const updateMembershipSchema = z.object({
  membershipId: z.string().uuid("media.roster.errors.invalid"),
  jerseyNumber: jersey,
  position,
});
export type UpdateMembershipInput = z.input<typeof updateMembershipSchema>;

export const moveMembershipSchema = z.object({
  membershipId: z.string().uuid("media.roster.errors.invalid"),
  toTeamId: z.string().uuid("media.roster.errors.invalid"),
});
export type MoveMembershipInput = z.input<typeof moveMembershipSchema>;

export const removeMembershipSchema = z.object({
  membershipId: z.string().uuid("media.roster.errors.invalid"),
});

/** First zod issue as an i18n key. */
export function rosterIssueKey(err: z.ZodError): string {
  const m = err.issues[0]?.message ?? "";
  return m.startsWith("media.") ? m : "media.roster.errors.invalid";
}

/** Map a database error to an i18n key. */
export function rosterErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("team_memberships_jersey_uniq")) return "media.roster.errors.jerseyTaken";
  if (m.includes("team_memberships_team_id_athlete_id_key")) return "media.roster.errors.alreadyOnTeam";
  if (m.includes("CROSS_ORG_REFERENCE")) return "media.roster.errors.invalid";
  if (m.includes("row-level security") || m.includes("permission denied") || m.includes("NOT_AUTHORIZED")) return "media.errors.forbidden";
  return "media.roster.errors.generic";
}

/** A team in a picker (season and programme for the groups of groupTeamsForPicker). */
export type TeamPickerOption = PickerTeam;

/**
 * Teams for the "Add to team…" dropdown: active teams only, the current
 * season first, then other seasons (newest name last is fine), then teams
 * without a season; alphabetical inside each group. Teams the athlete is
 * already on are left out.
 */
export function sortTeamsForPicker(teams: TeamPickerOption[], excludeIds: Iterable<string> = []): TeamPickerOption[] {
  const skip = new Set(excludeIds);
  const rank = (t: TeamPickerOption) => (t.isCurrentSeason ? 0 : t.seasonId ? 1 : 2);
  return teams
    .filter((t) => t.isActive && !skip.has(t.id))
    .sort((a, b) => rank(a) - rank(b) || (a.seasonName ?? "").localeCompare(b.seasonName ?? "") || a.name.localeCompare(b.name));
}

/** Accent- and case-insensitive fold for type-ahead search. */
export function foldSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Type-ahead filter for the roster "Add player" picker: every word of the
 * query must start a word of the name. Players already on the roster are
 * left out. At most `limit` results.
 */
export function filterPlayers<T extends { id: string; name: string }>(
  players: T[],
  query: string,
  excludeIds: Iterable<string> = [],
  limit = 8,
): T[] {
  const skip = new Set(excludeIds);
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  const out: T[] = [];
  for (const p of players) {
    if (skip.has(p.id)) continue;
    if (words.length) {
      const parts = foldSearch(p.name).split(/[\s-]+/);
      if (!words.every((w) => parts.some((part) => part.startsWith(w)))) continue;
    }
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

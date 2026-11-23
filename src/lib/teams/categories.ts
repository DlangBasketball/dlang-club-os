/**
 * Team categories for the admin Teams page: pure helpers (no I/O, no i18n).
 *
 * Teams are never listed by hard-coded name. A team's category comes from its
 * data, in this order:
 *   1. the `age_group` field ("U14", "u-14", "14U", "Under 14"),
 *   2. an age token in the team name ("U18 National", "U12/U14 AVB" -> U12:
 *      the first age named, so a mixed team sits with its youngest group),
 *   3. the `level` field ("Senior", "Masters"), used as the section label,
 *   4. otherwise the "other" bucket (callers translate its label).
 * Club teams and selection teams (players apply: EYBL, academies, elite
 * squads, i.e. teams of a selection programme) are split into two sections.
 */

export type CategorizableTeam = {
  id: string;
  name: string;
  ageGroup: string | null;
  level: string | null;
  isSelectionProgram: boolean;
};

export type AgeGroup = { label: string; age: number };

const AGE_PATTERNS: RegExp[] = [
  /\bU\s?-?\s?(\d{1,2})\b/i, // U14, U-14, U 14
  /\b(\d{1,2})\s?U\b/i, // 14U
  /\bunder[\s-]?(\d{1,2})\b/i, // Under 14, under-14
];

/** First age group named in a text ("U12/U14 AVB" -> U12), or null. */
export function parseAgeGroup(text: string | null | undefined): AgeGroup | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  let best: { index: number; age: number } | null = null;
  for (const re of AGE_PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const age = Number(m[1]);
    if (!Number.isFinite(age) || age < 4 || age > 30) continue;
    if (!best || m.index < best.index) best = { index: m.index, age };
  }
  return best ? { label: `U${best.age}`, age: best.age } : null;
}

export type TeamCategory = {
  section: "club" | "selection";
  /** Stable group key inside a section: "age:14", "level:senior", "other". */
  key: string;
  /** Group label from the data ("U14", "Senior"); null = "other" (caller translates). */
  label: string | null;
  /** Sort age (higher first); null for level / other groups. */
  age: number | null;
};

export function teamCategory(team: CategorizableTeam): TeamCategory {
  const section = team.isSelectionProgram ? "selection" : "club";
  const age = parseAgeGroup(team.ageGroup) ?? parseAgeGroup(team.name);
  if (age) return { section, key: `age:${age.age}`, label: age.label, age: age.age };
  const level = (team.level ?? "").trim();
  if (level) return { section, key: `level:${level.toLowerCase()}`, label: level, age: null };
  return { section, key: "other", label: null, age: null };
}

export type TeamGroup<T extends CategorizableTeam> = { key: string; label: string | null; age: number | null; teams: T[] };
export type TeamSections<T extends CategorizableTeam> = { club: TeamGroup<T>[]; selection: TeamGroup<T>[] };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Groups ordered: oldest age group first, then level groups (A-Z), then "other". */
function compareGroups(a: { key: string; label: string | null; age: number | null }, b: typeof a): number {
  const rank = (g: typeof a) => (g.age !== null ? 0 : g.key === "other" ? 2 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.age !== null && b.age !== null && a.age !== b.age) return b.age - a.age;
  return collator.compare(a.label ?? "", b.label ?? "");
}

/**
 * Split teams into club / selection sections, grouped by category. Every team
 * is kept (teams with no players included); order inside a group is by name.
 */
export function groupTeamsByCategory<T extends CategorizableTeam>(teams: T[]): TeamSections<T> {
  const sections: Record<"club" | "selection", Map<string, TeamGroup<T>>> = { club: new Map(), selection: new Map() };
  for (const t of teams) {
    const c = teamCategory(t);
    const groups = sections[c.section];
    const g = groups.get(c.key) ?? { key: c.key, label: c.label, age: c.age, teams: [] };
    g.teams.push(t);
    groups.set(c.key, g);
  }
  const finish = (m: Map<string, TeamGroup<T>>) =>
    Array.from(m.values())
      .map((g) => ({ ...g, teams: [...g.teams].sort((a, b) => collator.compare(a.name, b.name)) }))
      .sort(compareGroups);
  return { club: finish(sections.club), selection: finish(sections.selection) };
}

/** Normalised words of a player search ("  anna  MÜLLER " -> ["anna", "muller"]). */
export function searchWords(q: string | null | undefined, max = 3): string[] {
  return (q ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[%,()*\\'"]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, max);
}

/** Does a full name match every search word (accent- and case-insensitive)? */
export function nameMatches(name: string, words: string[]): boolean {
  if (!words.length) return false;
  const n = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return words.every((w) => n.includes(w));
}

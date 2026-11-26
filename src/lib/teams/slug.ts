/**
 * Team URL slugs. Same rule as the database function public.slugify_text()
 * (migration 20250420101800): lowercase, accents stripped, '/' and every other
 * non-alphanumeric -> '-', trimmed, at most 64 characters. The database
 * trigger trg_teams_slug generates and de-duplicates slugs per org (-2, -3 …);
 * this helper is for previews and validation in the app.
 */

export const TEAM_SLUG_MAX = 64;
export const TEAM_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const LIGATURES: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ħ: "h", ı: "i", ŧ: "t", ŀ: "l" };

export function slugifyText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ßæœøłđħıŧŀ]/g, (c) => LIGATURES[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TEAM_SLUG_MAX)
    .replace(/-+$/g, "");
}

export function isValidTeamSlug(s: string): boolean {
  return TEAM_SLUG_RE.test(s);
}

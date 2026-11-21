/**
 * Suggest which of the club's EXISTING app teams a website (SportsPress) team
 * is. Generic, white-label rules; nothing about a particular club:
 *
 *  - normalise: lowercase, accents stripped, dashes / punctuation -> spaces;
 *    "U-18", "U 18" and "18U" all become the age token "u18";
 *  - brand words: words that appear in most of the club's website team names
 *    (e.g. a shared club name) and the club's own name words carry no signal
 *    and are dropped from both sides;
 *  - the age group must be identical when either side names one;
 *  - the remaining words (league, level, gender …) are compared one to one,
 *    equal or a single typo apart (Damerau edit distance <= 1, words of 4+
 *    letters only, so "CSJC" ~ "CJSC" but "AVB" != "AVC");
 *  - a suggestion is made only when it is confident: every remaining word on
 *    both sides is matched and no other app team scores the same.
 *
 * No confident match -> null: the admin must choose (or explicitly create a
 * new team).
 */

export type AppTeamOption = { id: string; name: string };

/** Explicit "create a new app team" choice (never the default). */
export const NEW_TEAM = "new";
/** An existing app team id, or NEW_TEAM. */
export type TeamChoice = string;

const AGE_RE = /^u\d{1,2}$/;

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bu\s?(\d{1,2})\b/g, "u$1")
    .replace(/\b(\d{1,2})\s?u\b/g, "u$1")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokens(s: string): string[] {
  const n = normalizeName(s);
  return n ? n.split(" ") : [];
}

/** Optimal string alignment (Damerau) distance; a transposition counts 1. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  return a.length >= 4 && b.length >= 4 && editDistance(a, b) <= 1;
}

/**
 * Brand words: present in at least 75 % of the club's website team names
 * (needs 2+ names), never age tokens or numbers; plus the club name's words.
 */
export function brandWords(websiteTeamNames: string[], clubName?: string | null): Set<string> {
  const out = new Set<string>();
  const names = websiteTeamNames.map((n) => new Set(tokens(n)));
  if (names.length >= 2) {
    const counts = new Map<string, number>();
    for (const set of names) for (const w of set) counts.set(w, (counts.get(w) ?? 0) + 1);
    for (const [w, c] of counts) if (c / names.length >= 0.75 && !AGE_RE.test(w) && !/^\d+$/.test(w)) out.add(w);
  }
  for (const w of tokens(clubName ?? "")) if (w.length >= 3 && !AGE_RE.test(w)) out.add(w);
  return out;
}

type Parsed = { ages: string[]; words: string[] };

function parse(name: string, brand: ReadonlySet<string>): Parsed {
  const all = tokens(name).filter((w) => !brand.has(w));
  return { ages: all.filter((w) => AGE_RE.test(w)), words: all.filter((w) => !AGE_RE.test(w)) };
}

/** 0..1, or -1 when the age groups differ. */
export function teamScore(websiteName: string, appName: string, brand: ReadonlySet<string>): number {
  const a = parse(websiteName, brand);
  const b = parse(appName, brand);
  if (a.ages.length || b.ages.length) {
    if (a.ages.length !== b.ages.length || a.ages.some((x) => !b.ages.includes(x))) return -1;
  }
  if (!a.words.length && !b.words.length) return 1;
  const used = new Set<number>();
  let matched = 0;
  for (const w of a.words) {
    const j = b.words.findIndex((x, k) => !used.has(k) && sameWord(w, x));
    if (j >= 0) { used.add(j); matched++; }
  }
  return (2 * matched) / (a.words.length + b.words.length);
}

/**
 * Noise words for matching: the brand words above, plus words that appear in
 * 2+ website team names but in no app team name (a club prefix the app never
 * used, e.g. a shared sponsor or club nickname).
 */
export function noiseWords(
  websiteTeamNames: readonly string[],
  tickedNames: readonly string[],
  appTeams: readonly AppTeamOption[],
  clubName?: string | null,
): Set<string> {
  const out = brandWords([...tickedNames], clubName);
  const appWords = new Set(appTeams.flatMap((t) => tokens(t.name)));
  const counts = new Map<string, number>();
  for (const n of websiteTeamNames) for (const w of new Set(tokens(n))) counts.set(w, (counts.get(w) ?? 0) + 1);
  for (const [w, c] of counts) {
    if (c < 2 || AGE_RE.test(w) || /^\d+$/.test(w)) continue;
    if (![...appWords].some((a) => sameWord(a, w))) out.add(w);
  }
  return out;
}

/** The confident app team for a website team, or null. */
export function suggestAppTeam(
  websiteName: string,
  appTeams: readonly AppTeamOption[],
  noise: ReadonlySet<string>,
): string | null {
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const t of appTeams) {
    const s = teamScore(websiteName, t.name, noise);
    if (s < 1) continue; // confident = every word matched on both sides
    if (best && s === best.score) tie = true;
    else if (!best || s > best.score) { best = { id: t.id, score: s }; tie = false; }
  }
  return best && !tie ? best.id : null;
}

/** Title of an imported game: the APP team name (it wins over the website's) and the opponent. */
export function gameTitle(appTeamName: string, opponent: string | null): string {
  const o = opponent?.trim();
  return (o ? `${appTeamName} – ${o}` : appTeamName).slice(0, 160);
}

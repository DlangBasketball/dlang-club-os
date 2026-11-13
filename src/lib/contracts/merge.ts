/**
 * Contract merge fields (pure). Templates are plain text with placeholders
 * such as {{athlete.first_name}}; rendering is a SINGLE pass, so a value that
 * itself contains "{{...}}" is never expanded again. In HTML mode both the
 * template text and the values are escaped; in text mode the output is meant
 * for React text nodes and PDFs (which escape / do not interpret markup).
 */

export const MERGE_FIELDS = [
  "athlete.first_name",
  "athlete.last_name",
  "athlete.full_name",
  "athlete.dob",
  "guardian.full_name",
  "guardian.email",
  "family.name",
  "family.address",
  "programme.name",
  "programme.kind",
  "programme.location",
  "price",
  "currency",
  "dates",
  "start_date",
  "end_date",
  "club.name",
  "today",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeData = Partial<Record<MergeField, string>>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}\}/g;
const KNOWN: ReadonlySet<string> = new Set(MERGE_FIELDS);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Strip control characters (keeps tab / newline) so values cannot break PDFs or layouts. */
export function cleanValue(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, 2000);
}

/** Placeholders used in a template (in order of first appearance). */
export function extractMergeFields(body: string): string[] {
  const out: string[] = [];
  for (const m of Array.from(body.matchAll(PLACEHOLDER))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export function unknownMergeFields(body: string): string[] {
  return extractMergeFields(body).filter((f) => !KNOWN.has(f));
}

export type RenderResult = { output: string; missing: string[]; unknown: string[] };

/**
 * Render a template. Unknown placeholders and fields without a value render
 * as an empty string and are reported (`unknown` / `missing`).
 */
export function renderMerge(body: string, data: MergeData, mode: "text" | "html" = "text"): RenderResult {
  const missing: string[] = [];
  const unknown: string[] = [];
  let out = "";
  let last = 0;
  for (const m of Array.from(body.matchAll(PLACEHOLDER))) {
    const literal = body.slice(last, m.index);
    out += mode === "html" ? escapeHtml(literal) : literal;
    const key = m[1];
    if (!KNOWN.has(key)) {
      if (!unknown.includes(key)) unknown.push(key);
    } else {
      const raw = data[key as MergeField];
      if (raw === undefined || raw === null || raw === "") {
        if (!missing.includes(key)) missing.push(key);
      } else {
        const v = cleanValue(String(raw));
        out += mode === "html" ? escapeHtml(v) : v;
      }
    }
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = body.slice(last);
  out += mode === "html" ? escapeHtml(tail) : tail;
  return { output: out, missing, unknown };
}

/** HTML paragraphs from a rendered-in-HTML-mode text (blank line = new paragraph). */
export function toHtmlParagraphs(escaped: string): string {
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export const ACTIVITY_TYPES = ["team_season", "camp", "training_package", "other"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Activity type of a programme kind (camps, recurring teams, clinics ...). */
export function activityForProgramKind(kind: string | null | undefined): ActivityType {
  if (kind === "camp") return "camp";
  if (kind === "recurring_team") return "team_season";
  return "other";
}

/**
 * Choose the template for an activity: a published template bound to the
 * programme wins over a generic one of the same activity type; auto-issue only.
 */
export function pickTemplate<T extends { activityType: string; programId: string | null; status: string; autoIssue: boolean; updatedAt: string }>(
  templates: T[],
  activity: ActivityType,
  programId: string | null,
): T | null {
  const usable = templates.filter((t) => t.status === "published" && t.autoIssue && t.activityType === activity);
  const specific = programId ? usable.filter((t) => t.programId === programId) : [];
  const generic = usable.filter((t) => t.programId === null);
  const pool = specific.length ? specific : generic;
  return pool.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

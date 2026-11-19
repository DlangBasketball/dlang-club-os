import { DEFAULT_TERMINOLOGY } from "./defaults";
import { TERM_KEYS, type TermForms, type TermKey, type Terminology } from "./types";

/**
 * Configurable vocabulary. `term(t, "athlete")` -> "Player" for a club that
 * calls athletes players, "Student" for a school, etc.
 *
 *   term(tenant.terminology, "athlete")                    // "Player"
 *   term(tenant.terminology, "athlete", { plural: true })  // "Players"
 *   term(tenant.terminology, "program", { count: 1 })      // "Team"
 *   term(tenant.terminology, "coach", { case: "lower" })   // "coach"
 */

export type TermOptions = {
  plural?: boolean;
  count?: number;
  case?: "title" | "lower" | "upper";
};

const MAX_LEN = 40;
const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[<>{}]/g, "").trim().slice(0, MAX_LEN);
  return s || null;
};

function pluralize(one: string): string {
  if (/[^aeiou]y$/i.test(one)) return `${one.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(one)) return `${one}es`;
  return `${one}s`;
}

/** Accepts {one, other}, a bare string, or junk; returns complete forms. */
function toForms(v: unknown, fallback: TermForms): TermForms {
  if (typeof v === "string") {
    const one = clean(v);
    return one ? { one, other: pluralize(one) } : fallback;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const one = clean(o.one) ?? clean(o.singular);
    const other = clean(o.other) ?? clean(o.plural);
    if (one) return { one, other: other ?? pluralize(one) };
  }
  return fallback;
}

/** Normalise stored terminology jsonb into a complete, safe Terminology. */
export function normalizeTerminology(input: unknown): Terminology {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = {} as Terminology;
  for (const k of TERM_KEYS) out[k] = toForms(o[k], DEFAULT_TERMINOLOGY[k]);
  return out;
}

export function term(terminology: Terminology | undefined, key: TermKey, opts: TermOptions = {}): string {
  const forms = terminology?.[key] ?? DEFAULT_TERMINOLOGY[key];
  const plural = opts.plural ?? (typeof opts.count === "number" ? opts.count !== 1 : false);
  const s = plural ? forms.other : forms.one;
  if (opts.case === "lower") return s.toLowerCase();
  if (opts.case === "upper") return s.toUpperCase();
  return s;
}

/** Bind a terminology so callers can write t("athlete", { plural: true }). */
export function makeTerm(terminology: Terminology) {
  return (key: TermKey, opts?: TermOptions) => term(terminology, key, opts);
}
export type TermFn = ReturnType<typeof makeTerm>;

/** True when the tenant renamed `key` (e.g. athlete -> Student). */
export function isCustomTerm(terminology: Terminology | undefined, key: TermKey): boolean {
  const t = terminology?.[key];
  const d = DEFAULT_TERMINOLOGY[key];
  return Boolean(t && (t.one !== d.one || t.other !== d.other));
}

/**
 * Label for a UI string that names a configurable concept: the tenant's own
 * word when it renamed the concept, otherwise the translated catalogue label
 * (so an untouched tenant still gets "Athlètes" / "Athleten" in fr/de).
 */
export function termOr(terminology: Terminology | undefined, key: TermKey, translated: string, opts: TermOptions = {}): string {
  return isCustomTerm(terminology, key) ? term(terminology, key, opts) : translated;
}

/** Nav label keys that name a configurable concept, and which term they map to. */
export const NAV_TERM: Partial<Record<string, { key: TermKey; plural: boolean }>> = {
  athletes: { key: "athlete", plural: true },
  programs: { key: "program", plural: true },
  families: { key: "family", plural: true },
  children: { key: "athlete", plural: true },
  coaches: { key: "coach", plural: true },
};

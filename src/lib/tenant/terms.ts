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

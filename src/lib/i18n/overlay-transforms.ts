/**
 * Text transforms that generate regional overlay catalogs from their base
 * (scripts/i18n-sync.mjs). Zero dependencies and no path aliases: Node runs
 * this file directly from the scripts (type stripping), vitest imports it.
 *
 * Only the literal text of a message changes; ICU syntax (placeholder names,
 * plural/select keywords and selectors) is left untouched, so
 * "{program}" or "{kind, select, program {Program} other {…}}" stay valid.
 */

export type MessageTree = { [key: string]: string | MessageTree };

/** Apply `fn` to the literal text segments of an ICU-lite message. */
export function mapMessageText(msg: string, fn: (text: string) => string): string {
  let out = "";
  let i = 0;
  let literal = "";
  const flush = () => {
    if (literal) out += fn(literal);
    literal = "";
  };
  while (i < msg.length) {
    const ch = msg[i];
    if (ch !== "{") {
      literal += ch;
      i++;
      continue;
    }
    const close = matchBrace(msg, i);
    if (close === -1) {
      literal += msg.slice(i);
      break;
    }
    flush();
    const body = msg.slice(i + 1, close);
    const c1 = body.indexOf(",");
    if (c1 === -1) {
      out += `{${body}}`;
    } else {
      const rest = body.slice(c1 + 1);
      const c2 = rest.indexOf(",");
      if (c2 === -1) {
        out += `{${body}}`;
      } else {
        const head = body.slice(0, c1 + 1 + c2 + 1);
        const opts = rest.slice(c2 + 1);
        let j = 0;
        let mapped = "";
        while (j < opts.length) {
          const ob = opts.indexOf("{", j);
          if (ob === -1) {
            mapped += opts.slice(j);
            break;
          }
          const cb = matchBrace(opts, ob);
          if (cb === -1) {
            mapped += opts.slice(j);
            break;
          }
          mapped += opts.slice(j, ob + 1) + mapMessageText(opts.slice(ob + 1, cb), fn) + "}";
          j = cb + 1;
        }
        out += `{${head}${mapped}}`;
      }
    }
    i = close + 1;
  }
  flush();
  return out;
}

function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

// ---- Swiss German ----------------------------------------------------------

/** Swiss Standard German has no "ß": "Straße" -> "Strasse", "GROẞ" -> "GROSS". */
export function swissGerman(text: string): string {
  return text.replace(/ß/g, "ss").replace(/ẞ/g, "SS");
}

// ---- British English --------------------------------------------------------

/**
 * US -> British spelling, lower-case stems; case is preserved per match
 * ("Program" -> "Programme", "PROGRAM" -> "PROGRAMME"). Whole words only.
 * Words that are spelled the same in both (e.g. "program" as software) are
 * not an issue in this product: "program" always means a sports programme.
 */
export const US_TO_UK: Record<string, string> = {
  program: "programme",
  programs: "programmes",
  color: "colour",
  colors: "colours",
  colored: "coloured",
  canceled: "cancelled",
  canceling: "cancelling",
  enroll: "enrol",
  enrolls: "enrols",
  enrollment: "enrolment",
  enrollments: "enrolments",
  license: "licence",
  licenses: "licences",
  authorize: "authorise",
  authorized: "authorised",
  authorizes: "authorises",
  authorization: "authorisation",
  unauthorized: "unauthorised",
  organize: "organise",
  organized: "organised",
  organizes: "organises",
  organizing: "organising",
  organizer: "organiser",
  organizers: "organisers",
  organization: "organisation",
  organizations: "organisations",
  organizational: "organisational",
  recognize: "recognise",
  recognized: "recognised",
  unrecognized: "unrecognised",
  summarize: "summarise",
  summarized: "summarised",
  summarizes: "summarises",
  customize: "customise",
  customized: "customised",
  customizable: "customisable",
  personalize: "personalise",
  personalized: "personalised",
  prioritize: "prioritise",
  prioritized: "prioritised",
  categorize: "categorise",
  categorized: "categorised",
  finalize: "finalise",
  finalized: "finalised",
  optimize: "optimise",
  optimized: "optimised",
  minimize: "minimise",
  maximize: "maximise",
  standardize: "standardise",
  standardized: "standardised",
  synchronize: "synchronise",
  synchronized: "synchronised",
  anonymize: "anonymise",
  anonymized: "anonymised",
  anonymizes: "anonymises",
  apologize: "apologise",
  specialize: "specialise",
  specialized: "specialised",
  analyze: "analyse",
  analyzed: "analysed",
  center: "centre",
  centers: "centres",
  liter: "litre",
  liters: "litres",
  behavior: "behaviour",
  behaviors: "behaviours",
  favorite: "favourite",
  favorites: "favourites",
  honor: "honour",
  honors: "honours",
  labor: "labour",
  neighbor: "neighbour",
  catalog: "catalogue",
  catalogs: "catalogues",
  traveled: "travelled",
  traveling: "travelling",
  modeling: "modelling",
  labeled: "labelled",
  labeling: "labelling",
  fulfill: "fulfil",
  installment: "instalment",
  installments: "instalments",
  defense: "defence",
  offense: "offence",
  gray: "grey",
  practicing: "practising",
  "zip code": "postcode",
};

function preserveCase(sample: string, replacement: string): string {
  if (sample === sample.toUpperCase() && /[A-Z]/.test(sample)) return replacement.toUpperCase();
  if (sample[0] === sample[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

const UK_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${Object.keys(US_TO_UK)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/ /g, "\\s"))
    .join("|")})(?![\\p{L}\\p{N}_])`,
  "giu",
);

export function britishEnglish(text: string): string {
  return text.replace(UK_RE, (m) => {
    const key = m.toLowerCase().replace(/\s+/g, " ");
    const rep = US_TO_UK[key];
    return rep ? preserveCase(m, rep) : m;
  });
}

export type OverlayTransformName = "swiss-german" | "british-english" | "none";

export const TRANSFORMS: Record<OverlayTransformName, (text: string) => string> = {
  "swiss-german": swissGerman,
  "british-english": britishEnglish,
  none: (t) => t,
};

function flatten(tree: MessageTree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object") flatten(v, key, out);
  }
  return out;
}

function setPath(tree: MessageTree, key: string, value: string) {
  const parts = key.split(".");
  let node = tree;
  for (const p of parts.slice(0, -1)) {
    const next = node[p];
    if (!next || typeof next !== "object") node[p] = {};
    node = node[p] as MessageTree;
  }
  node[parts[parts.length - 1]] = value;
}

/**
 * Build an overlay catalog: every base message the transform changes, plus
 * hand-maintained `terms` (regional vocabulary, also passed through the
 * transform), keeping the base key order. Keys identical to the base are
 * omitted, so the overlay stays thin.
 */
export function buildOverlay(base: MessageTree, transform: OverlayTransformName, terms: MessageTree = {}): MessageTree {
  const fn = TRANSFORMS[transform];
  const flatBase = flatten(base);
  const flatTerms = flatten(terms);
  const out: MessageTree = {};
  for (const [key, value] of Object.entries(flatBase)) {
    const source = flatTerms[key] ?? value;
    const next = mapMessageText(source, fn);
    if (next !== value) setPath(out, key, next);
  }
  return out;
}

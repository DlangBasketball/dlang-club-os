import type { Locale } from "./config";
import type en from "@/messages/en.json";
import { formatNumber } from "@/lib/format";

/**
 * Typed message catalog. `en.json` is the source of truth: every other locale
 * is type-checked against it (see ./messages.ts), so a missing key is a
 * compile error, and `scripts/i18n-check.mjs` reports it in CI as well.
 */
export type Messages = typeof en;

type Join<K extends string, P extends string> = `${K}.${P}`;

/** Union of every dotted key path that leads to a string, e.g. "nav.dashboard". */
export type MessageKey<T = Messages> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends Record<string, unknown> ? Join<K, MessageKey<T[K]>> : never;
}[keyof T & string];

/** Dotted keys below a namespace: NamespaceKey<"nav"> = "dashboard" | "home" | ... */
export type Namespace = keyof Messages & string;
export type NamespaceKey<N extends Namespace> = MessageKey<Messages[N]>;

export type TranslateValues = Record<string, string | number | null | undefined>;

export type Translator = {
  (key: MessageKey, values?: TranslateValues): string;
  /** Like t(), but for keys built at runtime (e.g. `status.${row.status}`); returns fallback when missing. */
  dynamic: (key: string, values?: TranslateValues, fallback?: string) => string;
  /** True when the key exists in the catalog. */
  has: (key: string) => boolean;
  locale: Locale;
};

function lookup(messages: unknown, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

const pluralCache = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: string, n: number): string {
  let pr = pluralCache.get(locale);
  if (!pr) {
    pr = new Intl.PluralRules(locale);
    pluralCache.set(locale, pr);
  }
  return pr.select(n);
}

/** Find the index of the brace that closes the one at `open`. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Minimal ICU MessageFormat subset (no dependency):
 *   - interpolation:   "Hi {name}"
 *   - plurals:         "{count, plural, =0 {No invoices} one {# invoice} other {# invoices}}"
 *   - select:          "{role, select, coach {Coach} other {Member}}"
 * Unknown variables render as-is ("{name}") so missing data is visible, not silent.
 */
export function formatMessage(template: string, values: TranslateValues = {}, locale: string = "en"): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const close = matchBrace(template, i);
    if (close === -1) {
      out += template.slice(i);
      break;
    }
    const body = template.slice(i + 1, close);
    const firstComma = body.indexOf(",");
    if (firstComma === -1) {
      const name = body.trim();
      const v = values[name];
      out += v === undefined || v === null ? `{${name}}` : String(v);
    } else {
      const name = body.slice(0, firstComma).trim();
      const rest = body.slice(firstComma + 1);
      const secondComma = rest.indexOf(",");
      const kind = rest.slice(0, secondComma).trim();
      const optionsSrc = rest.slice(secondComma + 1);
      const options = new Map<string, string>();
      let j = 0;
      while (j < optionsSrc.length) {
        const ob = optionsSrc.indexOf("{", j);
        if (ob === -1) break;
        const selector = optionsSrc.slice(j, ob).trim();
        const cb = matchBrace(optionsSrc, ob);
        if (cb === -1) break;
        options.set(selector, optionsSrc.slice(ob + 1, cb));
        j = cb + 1;
      }
      const raw = values[name];
      let chosen: string | undefined;
      if (kind === "plural") {
        const n = Number(raw ?? 0);
        chosen = options.get(`=${n}`) ?? options.get(pluralCategory(locale, n)) ?? options.get("other");
        if (chosen !== undefined) {
          const numStr = formatNumber(n, locale);
          chosen = formatMessage(chosen, values, locale).replace(/#/g, numStr);
        }
      } else {
        chosen = options.get(String(raw)) ?? options.get("other");
        if (chosen !== undefined) chosen = formatMessage(chosen, values, locale);
      }
      out += chosen ?? "";
    }
    i = close + 1;
  }
  return out;
}

/**
 * Create a translator bound to a locale. `fallback` (normally the English
 * catalog) is used for any key missing in `messages`, so a partially
 * translated catalog degrades to English instead of showing raw keys.
 */
export function createTranslator(locale: Locale, messages: Messages, fallback?: Messages, intlLocale?: string): Translator {
  // Plural rules + "#" numbers use the regional tag (de-CH -> 1'234, not 1.234).
  const fmtLocale = intlLocale ?? locale;
  const resolve = (key: string): string | undefined => lookup(messages, key) ?? (fallback ? lookup(fallback, key) : undefined);
  const t = ((key: MessageKey, values?: TranslateValues) => {
    const tpl = resolve(key);
    if (tpl === undefined) {
      if (process.env.NODE_ENV !== "production") console.warn(`[i18n] missing key "${key}" for locale "${locale}"`);
      return key;
    }
    return formatMessage(tpl, values, fmtLocale);
  }) as Translator;
  t.dynamic = (key, values, fb) => {
    const tpl = resolve(key);
    return tpl === undefined ? fb ?? key : formatMessage(tpl, values, fmtLocale);
  };
  t.has = (key) => resolve(key) !== undefined;
  t.locale = locale;
  return t;
}

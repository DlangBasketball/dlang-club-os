/**
 * Site languages: any BCP 47 language tag (language [-Script] [-REGION]).
 *
 * Club websites are not limited to the app's own UI catalogs: a club may
 * publish in Portuguese, Arabic or Swiss German. Content (page / post
 * translations) is keyed by the canonical tag ("de-CH", "pt-BR"); URLs use the
 * lower-cased tag as a prefix (/de-ch/...). Site chrome (header, footer,
 * buttons) falls back to the nearest app catalog: de-CH -> de -> default -> en.
 *
 * Pure: safe in server, client and edge code. Mirrors
 * public.site_language_tag_valid() in the site migration.
 */

const TAG_RE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;

/** Canonical BCP 47 subset accepted for site content ("en", "de-CH", "zh-Hant", "es-419"). */
export function isLanguageTag(v: unknown): v is string {
  return typeof v === "string" && v.length <= 20 && TAG_RE.test(v);
}

/**
 * Canonical case for a loosely written tag ("pt_br" / "PT-br" -> "pt-BR",
 * "zh-hant" -> "zh-Hant"). Returns null when it cannot be a tag.
 */
export function canonicalTag(input: string | null | undefined): string | null {
  if (!input) return null;
  const parts = String(input).trim().replace(/_/g, "-").split("-").filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  const [lang, ...rest] = parts;
  if (!/^[a-zA-Z]{2,3}$/.test(lang!)) return null;
  const out = [lang!.toLowerCase()];
  for (const p of rest) {
    if (/^[a-zA-Z]{4}$/.test(p) && out.length === 1) out.push(p[0]!.toUpperCase() + p.slice(1).toLowerCase());
    else if (/^[a-zA-Z]{2}$/.test(p) || /^[0-9]{3}$/.test(p)) out.push(p.toUpperCase());
    else return null;
  }
  const tag = out.join("-");
  return isLanguageTag(tag) ? tag : null;
}

/** URL prefix of a tag (/de-ch/...). */
export function langSlug(tag: string): string {
  return tag.toLowerCase();
}

/** The enabled tag a URL segment names, or null ("de-ch" -> "de-CH"). */
export function tagFromSlug(segment: string | null | undefined, enabled: readonly string[]): string | null {
  if (!segment) return null;
  const s = segment.toLowerCase();
  return enabled.find((t) => t.toLowerCase() === s) ?? null;
}

const RTL = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb"]);

/** Text direction of a language tag. */
export function textDir(tag: string | null | undefined): "rtl" | "ltr" {
  if (!tag) return "ltr";
  const [lang, second] = tag.split("-");
  // Scripts written right to left win over the language default (e.g. "pa-Arab").
  if (second && /^(Arab|Hebr|Thaa|Syrc|Nkoo|Adlm)$/.test(second)) return "rtl";
  if (second && /^[A-Z][a-z]{3}$/.test(second)) return "ltr";
  return RTL.has((lang ?? "").toLowerCase()) ? "rtl" : "ltr";
}

/**
 * Lookup chain for UI strings of a tag: the tag itself, its language, the
 * site default (and its language), then English. Only entries in `available`
 * (the app's UI catalogs) are returned, in order, without duplicates.
 */
export function uiFallbackChain(tag: string, available: readonly string[], siteDefault?: string | null): string[] {
  const want: string[] = [];
  const push = (t: string | null | undefined) => {
    if (!t) return;
    want.push(t);
    const base = t.split("-")[0]!;
    if (base !== t) want.push(base);
  };
  push(tag);
  push(siteDefault);
  want.push("en");
  const lower = new Map(available.map((a) => [a.toLowerCase(), a]));
  const out: string[] = [];
  for (const w of want) {
    const hit = lower.get(w.toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** The app UI catalog to use for a site language. */
export function uiCatalogFor(tag: string, available: readonly string[], siteDefault?: string | null): string {
  return uiFallbackChain(tag, available, siteDefault)[0] ?? "en";
}

/** A language's name in its own language ("de-CH" -> "Deutsch (Schweiz)"). */
export function nativeLanguageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    if (name && name !== tag) return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    /* unknown to this runtime */
  }
  return tag;
}

/** A language's name in the viewer's language (admin lists). */
export function languageNameIn(tag: string, displayLocale: string): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Parse a comma / space separated list of tags (admin input) -> canonical, unique. */
export function parseLanguageList(input: string | readonly string[]): { tags: string[]; invalid: string[] } {
  const raw = Array.isArray(input) ? input : String(input).split(/[\s,;]+/);
  const tags: string[] = [];
  const invalid: string[] = [];
  for (const r of raw) {
    const v = String(r).trim();
    if (!v) continue;
    const c = canonicalTag(v);
    if (!c) invalid.push(v);
    else if (!tags.some((t) => t.toLowerCase() === c.toLowerCase())) tags.push(c);
  }
  return { tags, invalid };
}

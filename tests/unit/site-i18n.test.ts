import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import fr from "@/messages/fr.json";
import it_ from "@/messages/it.json";
import es from "@/messages/es.json";
import { BLOCK_FIELDS, BLOCK_TYPES, FORM_KINDS, LANG_STATES, LIVE_SOURCES } from "@/lib/site/blocks";
import { LOCALES } from "@/lib/i18n/config";
import { getTranslator } from "@/lib/i18n/messages";
import { uiCatalogFor } from "@/lib/site/languages";

/**
 * The site builds many keys at runtime (t.dynamic). Every key family must exist
 * in every catalog, otherwise visitors and admins would see raw keys.
 */

type Tree = Record<string, unknown>;
const get = (cat: Tree, key: string): unknown => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Tree)[k] : undefined), cat);

function dynamicKeys(): string[] {
  const keys: string[] = [];
  for (const b of BLOCK_TYPES) keys.push(`site.blocks.${b}`, `site.blockHints.${b}`);
  for (const fields of Object.values(BLOCK_FIELDS)) {
    for (const f of fields) {
      keys.push(`site.fields.${f.key}`);
      for (const o of f.options ?? []) keys.push(`site.options.${f.key}.${o}`);
      for (const sub of f.item ?? []) keys.push(`site.fields.${sub.key}`);
    }
  }
  for (const s of [...LIVE_SOURCES, "manual", "sponsors"]) keys.push(`site.liveHints.${s}`);
  for (const s of LIVE_SOURCES) keys.push(`site.live.titles.${s}`);
  for (const k of FORM_KINDS) keys.push(`site.form.titles.${k}`);
  for (const s of LANG_STATES) keys.push(`site.langState.${s}`);
  for (const s of ["draft", "published", "scheduled"]) keys.push(`site.status.${s}`);
  for (const s of ["new", "handled", "spam"]) keys.push(`site.forms.status.${s}`);
  for (const s of ["pages", "posts", "forms", "redirects", "import", "settings"]) keys.push(`site.admin.tabs.${s}`);
  for (const s of ["pages", "home", "languages", "redirects", "enabled", "domain", "sitemap"]) keys.push(`site.checklist.items.${s}`);
  for (const s of ["arena", "court", "classic"]) keys.push(`site.templates.${s}`, `site.templates.${s}Hint`);
  for (const s of ["primary", "accent", "background", "surface", "text"]) keys.push(`site.settings.colors.${s}`);
  for (let i = 0; i < 6; i++) keys.push(`site.settings.contrastPairs.${i}`);
  for (const s of ["unsafe_url", "not_wordpress", "network", "too_large"]) keys.push(`site.import.errors.${s}`);
  for (const s of ["plugin_page", "shortcode_only", "empty", "test_page", "not_published"]) keys.push(`site.import.skip.${s}`);
  for (const s of ["pagesCreated", "pagesUpdated", "postsCreated", "postsUpdated", "imagesImported", "imagesFailed", "imagesRemaining", "redirects", "skipped"]) keys.push(`site.import.report.${s}`);
  for (const s of ["save", "publish", "schedule", "before_restore", "before_import"]) keys.push(`site.versionNotes.${s}`);
  for (const s of ["default", "landing", "narrow"]) keys.push(`site.options.layout.${s}`);
  for (const p of ["home", "about", "camps", "programs", "teams", "staff", "training", "schedule", "shop", "donate", "news", "join", "contact"]) {
    keys.push(`site.starter.${p}.title`, `site.starter.${p}.lead`, `site.starter.${p}.nav`);
  }
  for (const s of ["camps", "book", "contact", "join", "shop"]) keys.push(`site.starter.cta.${s}`);
  keys.push("nav.site");
  return Array.from(new Set(keys));
}

describe("site i18n", () => {
  const catalogs = { en, de, fr, it: it_, es } as Record<string, Tree>;
  it.each(Object.keys(catalogs))("%s has every dynamic site key", (loc) => {
    const missing = dynamicKeys().filter((k) => typeof get(catalogs[loc]!, k) !== "string");
    expect(missing).toEqual([]);
  });

  it("Swiss German never uses ß in site texts", () => {
    expect(JSON.stringify(de.site)).not.toContain("ß");
  });

  it("site chrome falls back to the nearest app catalog", () => {
    expect(getTranslator(uiCatalogFor("de-CH", LOCALES) as "de")("site.chrome.myAccount")).toBe(de.site.chrome.myAccount);
    expect(getTranslator(uiCatalogFor("fr-CA", LOCALES) as "fr")("site.chrome.myAccount")).toBe(fr.site.chrome.myAccount);
    expect(getTranslator(uiCatalogFor("pt-BR", LOCALES) as "en")("site.chrome.myAccount")).toBe(en.site.chrome.myAccount);
  });
});

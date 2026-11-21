#!/usr/bin/env node
/**
 * Translation coverage per registry language.
 *
 *   npm run i18n:coverage                      # table for every language
 *   npm run i18n:coverage -- --missing de-CH   # list the missing keys of one language
 *   npm run i18n:coverage -- --json            # machine-readable
 *   npm run i18n:coverage -- --markdown        # table for docs / PRs
 *
 * "Translated" = the value users see comes from a non-English catalog in the
 * language's chain (de-CH: de-CH overlay, then de) and is not just the
 * English text (allow-listed international words count as translated).
 */
import {
  LANGUAGES,
  SOURCE_LOCALE,
  catalogChain,
  flatten,
  isTranslated,
  loadCatalogFiles,
} from "./lib/i18n.mjs";

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const MARKDOWN = argv.includes("--markdown");
const missingFor = argv.includes("--missing") ? argv[argv.indexOf("--missing") + 1] : null;

const files = loadCatalogFiles();
const en = flatten(files[SOURCE_LOCALE]);
const keys = Object.keys(en);

function coverage(entry) {
  const tag = entry.tag;
  if (tag === SOURCE_LOCALE) return { translated: keys.length, missing: [] };
  if (entry.status === "none" || !files[tag]) return { translated: 0, missing: keys };
  // Non-English layers of the chain, most specific first.
  const layers = catalogChain(tag)
    .filter((t) => t !== SOURCE_LOCALE && files[t])
    .map((t) => flatten(files[t]));
  const isEnglishVariant = tag.split("-")[0] === SOURCE_LOCALE;
  const missing = [];
  let translated = 0;
  for (const k of keys) {
    const value = layers.map((l) => l[k]).find((v) => typeof v === "string" && v.trim());
    // English variants (en-GB) inherit the English source as their translation.
    const ok = isEnglishVariant ? true : isTranslated(k, value, en[k], tag.split("-")[0]) || isTranslated(k, value, en[k], tag);
    if (ok) translated++;
    else missing.push(k);
  }
  return { translated, missing };
}

const rows = LANGUAGES.map((entry) => {
  const c = coverage(entry);
  const own = files[entry.tag] ? Object.keys(flatten(files[entry.tag])).length : 0;
  return {
    tag: entry.tag,
    name: entry.englishName,
    status: entry.status,
    dir: entry.dir,
    kind: entry.overlay ? `overlay on ${entry.overlay.base}` : "base",
    ownKeys: own,
    translated: c.translated,
    total: keys.length,
    percent: Math.floor((c.translated / keys.length) * 1000) / 10,
    missing: c.missing,
  };
});

if (missingFor) {
  const row = rows.find((r) => r.tag === missingFor);
  if (!row) {
    console.error(`unknown language "${missingFor}" (not in src/lib/i18n/languages.ts)`);
    process.exit(1);
  }
  console.log(`${row.tag}: ${row.missing.length} missing / untranslated key(s)`);
  for (const k of row.missing) console.log(`  ${k} = ${JSON.stringify(en[k])}`);
  process.exit(0);
}

if (JSON_OUT) {
  console.log(JSON.stringify(rows.map(({ missing, ...r }) => ({ ...r, missingCount: missing.length, missingSample: missing.slice(0, 20) })), null, 2));
  process.exit(0);
}

const header = ["Language", "Tag", "Status", "Dir", "Catalog", "Own keys", "Translated", "Coverage", "Missing"];
const body = rows.map((r) => [r.name, r.tag, r.status, r.dir, r.kind, String(r.ownKeys), `${r.translated}/${r.total}`, `${r.percent.toFixed(1)}%`, String(r.missing.length)]);
if (MARKDOWN) {
  console.log(`| ${header.join(" | ")} |`);
  console.log(`|${header.map(() => "---").join("|")}|`);
  for (const b of body) console.log(`| ${b.join(" | ")} |`);
} else {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const b of body) console.log(line(b));
  console.log(`\nSource: ${SOURCE_LOCALE}.json, ${keys.length} keys. Missing keys of one language: npm run i18n:coverage -- --missing <tag>`);
}

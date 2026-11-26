#!/usr/bin/env node
/**
 * Export a language for translators (JSON or XLIFF 1.2).
 *
 *   npm run i18n:export -- --lang nl --format xliff --out nl.xlf
 *   npm run i18n:export -- --lang de --missing-only --format json --out de-todo.json
 *   npm run i18n:export -- --lang fr                 # JSON to stdout
 *
 * Every unit carries the English source, the current translation (empty when
 * missing) and a note listing the placeholders to keep. Without --out the
 * file goes to stdout.
 */
import { writeFileSync } from "node:fs";
import { toXliff } from "./lib/xliff.mjs";
import {
  LANGUAGES,
  SOURCE_LOCALE,
  catalogChain,
  flatten,
  isTranslated,
  loadCatalogFiles,
  placeholders,
} from "./lib/i18n.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const lang = opt("--lang");
const format = opt("--format", "json");
const out = opt("--out");
const missingOnly = argv.includes("--missing-only");

if (!lang || !["json", "xliff"].includes(format)) {
  console.error("usage: i18n-export --lang <tag> [--format json|xliff] [--missing-only] [--out file]");
  process.exit(2);
}

const entry = LANGUAGES.find((l) => l.tag === lang);
const files = loadCatalogFiles();
const en = flatten(files[SOURCE_LOCALE]);
// Current translations: the language's own chain without English.
const layers = (entry ? catalogChain(lang) : [lang]).filter((t) => t !== SOURCE_LOCALE && files[t]).map((t) => flatten(files[t]));
if (!entry) console.error(`note: "${lang}" is not in src/lib/i18n/languages.ts yet; add it (status "none" -> "partial") before importing.`);

const units = [];
for (const [key, source] of Object.entries(en)) {
  const current = layers.map((l) => l[key]).find((v) => typeof v === "string" && v.trim()) ?? "";
  const done = current && isTranslated(key, current, source, lang.split("-")[0]);
  if (missingOnly && done) continue;
  const ph = [...placeholders(source)];
  units.push({
    id: key,
    source,
    target: done ? current : "",
    state: done ? "translated" : "new",
    note: ph.length ? `Keep placeholders: {${ph.join("}, {")}}` : undefined,
  });
}

const content =
  format === "xliff"
    ? toXliff({ sourceLanguage: SOURCE_LOCALE, targetLanguage: lang, units })
    : JSON.stringify(
        {
          sourceLanguage: SOURCE_LOCALE,
          targetLanguage: lang,
          status: entry?.status ?? "none",
          entries: Object.fromEntries(units.map((u) => [u.id, { source: u.source, target: u.target, ...(u.note ? { note: u.note } : {}) }])),
        },
        null,
        2,
      ) + "\n";

if (out) {
  writeFileSync(out, content);
  console.error(`exported ${units.length} unit(s) for ${lang} to ${out}`);
} else {
  process.stdout.write(content);
}

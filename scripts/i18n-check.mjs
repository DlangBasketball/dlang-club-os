#!/usr/bin/env node
/**
 * i18n catalog checker — zero dependencies, driven by the language registry
 * (src/lib/i18n/languages.ts).
 *
 *   npm run i18n:check                # report; exit 1 on errors
 *   npm run i18n:check -- --strict    # also fail on warnings
 *   npm run i18n:check -- --json      # machine-readable output
 *
 * Errors:
 *   - a "complete" language misses a key (base catalog, or the merged chain of an overlay)
 *   - key not in en.json (base catalogs and overlays)
 *   - value is not a string / is empty
 *   - placeholder mismatch ({name} in en but not in de, …)
 *   - plural/select block without an `other` branch
 *   - "ß" anywhere in the merged Swiss German catalog (de-CH)
 *   - generated overlays or src/messages/index.ts out of date (run npm run i18n:sync)
 *   - catalog file without registry entry, or registry entry (status != none) without file
 *   - t("key") used in src/ that does not exist in en.json
 * Warnings:
 *   - value identical to English in a base catalog (possibly untranslated)
 * Info:
 *   - missing keys of "partial" (beta) languages: allowed, they fall back
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CATALOG_LANGUAGES,
  LANGUAGES,
  ROOT,
  SAME_AS_EN_OK,
  SOURCE_LOCALE,
  SRC_DIR,
  effectiveCatalog,
  flatten,
  loadCatalogFiles,
  placeholderDiff,
  pluralBlocksMissingOther,
} from "./lib/i18n.mjs";

const args = new Set(process.argv.slice(2));
const STRICT = args.has("--strict");
const JSON_OUT = args.has("--json");

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(p, files);
    } else if (/\.(tsx?|mjs|js)$/.test(name)) files.push(p);
  }
  return files;
}

/** Find literal t("a.b") / t('a.b') calls in source files. */
function usedKeys() {
  const used = new Map();
  const re = /\bt\(\s*["'`]([a-zA-Z][\w]*(?:\.[\w]+)+)["'`]/g;
  for (const file of walk(SRC_DIR)) {
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    let m;
    while ((m = re.exec(src))) {
      if (m[0].includes("`") && m[1].includes("${")) continue;
      if (!used.has(m[1])) used.set(m[1], relative(ROOT, file));
    }
  }
  return used;
}

const files = loadCatalogFiles();
if (!files[SOURCE_LOCALE]) {
  console.error(`✖ missing source catalog src/messages/${SOURCE_LOCALE}.json`);
  process.exit(1);
}
const en = flatten(files[SOURCE_LOCALE]);
const sourceKeys = Object.keys(en);
const report = {};
let errorCount = 0;
let warnCount = 0;
const add = (tag) => (report[tag] ??= { status: "", overlay: null, keys: 0, missing: 0, errors: [], warnings: [], info: [] });

// Registry <-> files ------------------------------------------------------------
const registered = new Map(LANGUAGES.map((l) => [l.tag, l]));
for (const tag of Object.keys(files)) {
  const entry = registered.get(tag);
  if (!entry) add(tag).errors.push(`src/messages/${tag}.json has no entry in src/lib/i18n/languages.ts`);
  else if (entry.status === "none") add(tag).errors.push(`registry status is "none" but src/messages/${tag}.json exists (set it to "partial")`);
}
for (const entry of CATALOG_LANGUAGES) {
  if (!files[entry.tag]) add(entry.tag).errors.push(`registry status "${entry.status}" but src/messages/${entry.tag}.json is missing`);
}

// Per language ------------------------------------------------------------------
for (const entry of CATALOG_LANGUAGES) {
  const tag = entry.tag;
  if (!files[tag]) continue;
  const r = add(tag);
  r.status = entry.status;
  r.overlay = entry.overlay ? `${entry.overlay.base} (${entry.overlay.transform})` : null;
  const own = flatten(files[tag]);
  r.keys = Object.keys(own).length;

  for (const [key, value] of Object.entries(own)) {
    if (!(key in en)) {
      r.errors.push(`extra key not in ${SOURCE_LOCALE}.json: ${key}`);
      continue;
    }
    if (typeof value !== "string") {
      r.errors.push(`not a string: ${key}`);
      continue;
    }
    if (!value.trim()) {
      r.errors.push(`empty value: ${key}`);
      continue;
    }
    if (tag === SOURCE_LOCALE) {
      for (const p of pluralBlocksMissingOther(value)) r.errors.push(`${key}: ${p}`);
      continue;
    }
    const { missing, extra } = placeholderDiff(en[key], value);
    if (missing.length) r.errors.push(`placeholder(s) {${missing.join("}, {")}} missing in ${key}`);
    if (extra.length) r.errors.push(`unknown placeholder(s) {${extra.join("}, {")}} in ${key}`);
    for (const p of pluralBlocksMissingOther(value)) r.errors.push(`${key}: ${p}`);
    if (!entry.overlay && value === en[key] && !SAME_AS_EN_OK.has(key) && !SAME_AS_EN_OK.has(`${tag}:${key}`) && /[a-z]{3,}/i.test(value)) {
      r.warnings.push(`same as English (untranslated?): ${key} = "${value}"`);
    }
  }

  // Completeness of what users actually see (overlays inherit their base).
  const effective = effectiveCatalog(tag, files);
  const chainOwn = entry.overlay ? flatten(files[entry.overlay.base] ?? {}) : own;
  const missingKeys = sourceKeys.filter((k) => !(k in chainOwn) && !(k in own));
  r.missing = missingKeys.length;
  if (missingKeys.length) {
    if (entry.status === "complete") {
      for (const k of missingKeys) r.errors.push(`missing key: ${k}`);
    } else {
      r.info.push(`${missingKeys.length} key(s) not translated yet (status "${entry.status}": English fallback)`);
    }
  }

  // Swiss German: no sharp s anywhere in what Swiss users see.
  if (entry.overlay?.transform === "swiss-german" || /^de-(CH|LI)$/.test(tag)) {
    for (const [k, v] of Object.entries(effective)) {
      if (typeof v === "string" && /[ßẞ]/.test(v)) r.errors.push(`"ß" in ${k} (Swiss German uses "ss"; run npm run i18n:sync)`);
    }
  }
}

// Generated files in sync -------------------------------------------------------
const sync = spawnSync(process.execPath, ["--no-warnings", join(ROOT, "scripts", "i18n-sync.mjs"), "--check"], { encoding: "utf8" });
if (sync.status !== 0) add("_generated").errors.push((sync.stderr || sync.stdout).trim());

// t() usage ---------------------------------------------------------------------
const usage = usedKeys();
for (const [k, file] of usage.entries()) {
  if (!(k in en)) add("_source").errors.push(`t("${k}") in ${file} is not in ${SOURCE_LOCALE}.json`);
}

for (const r of Object.values(report)) {
  errorCount += r.errors.length;
  warnCount += r.warnings.length;
}

if (JSON_OUT) {
  console.log(JSON.stringify({ errors: errorCount, warnings: warnCount, locales: report }, null, 2));
} else {
  console.log(`i18n check — source: ${SOURCE_LOCALE}.json (${sourceKeys.length} keys), catalogs: ${CATALOG_LANGUAGES.map((l) => l.tag).join(", ")}`);
  console.log(`literal t() keys used in src/: ${usage.size}`);
  for (const [tag, r] of Object.entries(report)) {
    const mark = r.errors.length ? "✖" : r.warnings.length ? "!" : "✔";
    const kind = r.overlay ? `overlay on ${r.overlay}, ` : "";
    console.log(`\n${mark} ${tag}${r.status ? ` [${r.status}]` : ""}: ${kind}${r.keys} keys, ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
    for (const e of r.errors) console.log(`   ✖ ${e}`);
    for (const w of r.warnings) console.log(`   ! ${w}`);
    for (const i of r.info) console.log(`   · ${i}`);
  }
  console.log(`\n${errorCount} error(s), ${warnCount} warning(s).`);
}

process.exit(errorCount > 0 || (STRICT && warnCount > 0) ? 1 : 0);

#!/usr/bin/env node
/**
 * Import translations (JSON or XLIFF 1.2, as produced by i18n-export) into
 * the catalogs.
 *
 *   npm run i18n:import -- nl.xlf
 *   npm run i18n:import -- de-todo.json --dry-run
 *   npm run i18n:import -- pl.xlf --machine      # machine draft: language must stay "partial"
 *
 * Rules:
 *   - unknown keys, empty targets and placeholder / plural mismatches are
 *     rejected (listed), everything else is merged;
 *   - base languages write src/messages/<tag>.json (created if needed);
 *     regional overlays only keep values that differ from their base: a
 *     hand-written overlay (fr-CH) gets them directly, a generated overlay
 *     (de-CH, en-GB) gets them in src/messages/overlays/<tag>.terms.json and
 *     is regenerated;
 *   - machine drafts (--machine, or XLIFF state "needs-review-translation")
 *     are refused for a language whose registry status is "complete": a
 *     native speaker reviews before a language is marked complete.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { parseXliff } from "./lib/xliff.mjs";
import {
  LANGUAGES,
  ROOT,
  SOURCE_LOCALE,
  catalogChain,
  catalogPath,
  flatten,
  loadCatalogFiles,
  placeholderDiff,
  pluralBlocksMissingOther,
  readJson,
  termsPath,
  unflatten,
  writeJson,
} from "./lib/i18n.mjs";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--lang");
const langOpt = argv.includes("--lang") ? argv[argv.indexOf("--lang") + 1] : null;
const DRY = argv.includes("--dry-run");
const MACHINE = argv.includes("--machine");

if (!file || !existsSync(file)) {
  console.error("usage: i18n-import <file.json|file.xlf> [--lang <tag>] [--dry-run] [--machine]");
  process.exit(2);
}

const raw = readFileSync(file, "utf8");
let lang;
let units;
if (/^\s*</.test(raw)) {
  const x = parseXliff(raw);
  lang = langOpt ?? x.targetLanguage;
  units = x.units.map((u) => ({ id: u.id, target: u.target, machine: u.state === "needs-review-translation" }));
} else {
  const j = JSON.parse(raw);
  lang = langOpt ?? j.targetLanguage;
  const entries = j.entries ?? j;
  units = Object.entries(entries).map(([id, v]) => ({ id, target: typeof v === "string" ? v : v?.target ?? "", machine: false }));
}
if (!lang) {
  console.error("target language unknown: pass --lang <tag>");
  process.exit(2);
}
if (lang === SOURCE_LOCALE) {
  console.error("en.json is the source catalog: edit it directly.");
  process.exit(2);
}

const entry = LANGUAGES.find((l) => l.tag === lang);
const files = loadCatalogFiles();
const en = flatten(files[SOURCE_LOCALE]);
const machineCount = units.filter((u) => u.machine && u.target).length + (MACHINE ? units.filter((u) => u.target).length : 0);
if (entry?.status === "complete" && machineCount > 0) {
  console.error(`✖ ${lang} is "complete" (native-reviewed). Machine drafts are only allowed for "partial" languages; have a native speaker review, then import without --machine.`);
  process.exit(1);
}

const accepted = {};
const rejected = [];
for (const u of units) {
  if (!(u.id in en)) rejected.push(`${u.id}: not in ${SOURCE_LOCALE}.json`);
  else if (typeof u.target !== "string" || !u.target.trim()) continue;
  else {
    const { missing, extra } = placeholderDiff(en[u.id], u.target);
    const plural = pluralBlocksMissingOther(u.target);
    if (missing.length) rejected.push(`${u.id}: placeholder(s) {${missing.join("}, {")}} missing`);
    else if (extra.length) rejected.push(`${u.id}: unknown placeholder(s) {${extra.join("}, {")}}`);
    else if (plural.length) rejected.push(`${u.id}: ${plural.join("; ")}`);
    else accepted[u.id] = u.target;
  }
}

let written = 0;
let target;
if (entry?.overlay) {
  // Keep only what differs from the base the overlay sits on.
  const base = {};
  for (const t of catalogChain(entry.overlay.base).reverse()) Object.assign(base, flatten(files[t] ?? {}));
  const generated = entry.overlay.transform !== "none";
  target = generated ? termsPath(lang) : catalogPath(lang);
  const current = flatten(readJson(target, {}));
  for (const [k, v] of Object.entries(accepted)) {
    if (v === base[k] && !(k in current)) continue;
    if (current[k] !== v) written++;
    current[k] = v;
  }
  if (!DRY) writeJson(target, unflatten(current, Object.keys(en)));
  if (!DRY && generated) spawnSync(process.execPath, ["--no-warnings", join(ROOT, "scripts", "i18n-sync.mjs")], { stdio: "inherit" });
} else {
  target = catalogPath(lang);
  const current = flatten(readJson(target, {}));
  for (const [k, v] of Object.entries(accepted)) {
    if (current[k] !== v) written++;
    current[k] = v;
  }
  if (!DRY) writeJson(target, unflatten(current, Object.keys(en)));
}

console.log(`${DRY ? "[dry run] " : ""}${lang}: ${Object.keys(accepted).length} accepted, ${written} changed, ${rejected.length} rejected → ${relative(ROOT, target)}`);
for (const r of rejected.slice(0, 50)) console.log(`  ✖ ${r}`);
if (rejected.length > 50) console.log(`  … ${rejected.length - 50} more`);
if (!entry || entry.status === "none") {
  console.log(`next: set "${lang}" to status "partial" in src/lib/i18n/languages.ts, then run npm run i18n:sync and npm run i18n:coverage.`);
}
process.exit(rejected.length ? 1 : 0);

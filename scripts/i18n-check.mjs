#!/usr/bin/env node
/**
 * i18n catalog checker — zero dependencies.
 *
 *   node scripts/i18n-check.mjs            # report; exit 1 on errors
 *   node scripts/i18n-check.mjs --strict   # also fail on warnings
 *   node scripts/i18n-check.mjs --json     # machine-readable output
 *
 * Errors:
 *   - key present in en.json but missing in another locale (or vice versa)
 *   - value is not a string / is empty
 *   - placeholder mismatch ({name} in en but not in de, …)
 *   - plural/select block without an `other` branch
 *   - "ß" in German (Swiss German uses "ss")
 *   - t("key") used in src/ that does not exist in en.json
 * Warnings:
 *   - value identical to English (possibly untranslated)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGES_DIR = join(ROOT, "src", "messages");
const SRC_DIR = join(ROOT, "src");
const SOURCE = "en";
const args = new Set(process.argv.slice(2));
const STRICT = args.has("--strict");
const JSON_OUT = args.has("--json");

// Strings that are legitimately the same across languages.
const SAME_AS_EN_OK = new Set([
  "meta.direction",
  "common.status",
  "common.total",
  "common.date",
  "common.name",
  "common.notes",
  "common.actions",
  "common.no",
  "nav.assistant",
  "nav.documents",
  "nav.notifications",
  "nav.home",
  "nav.account",
  "shell.clubOs",
  "shell.notifications",
  "status.open",
  "invoices.total",
  "programKind.camp",
  "programKind.clinic",
  "payments.methods.twint",
  "notifications.channels.push",
  "notifications.channels.sms",
  "notifications.title",
  "notifications.types.system",
  "parentHome.notifications",
  "registration.review.lineItem",
  "booking.duration",
  "roles.parent",
  "email.adminRegistrationAlert.parent",
  "common.optional",
  "common.subtotal",
  "registration.consents.optional",
  "nav.invitations",
]);

/** Flatten nested JSON into { "a.b.c": value }. */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** Top-level variable names in an ICU-lite message: {name}, {count, plural, ...}. */
function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function placeholders(msg, names = new Set()) {
  let i = 0;
  while (i < msg.length) {
    const open = msg.indexOf("{", i);
    if (open === -1) break;
    const close = matchBrace(msg, open);
    if (close === -1) break;
    const body = msg.slice(open + 1, close);
    const comma = body.indexOf(",");
    if (comma === -1) {
      if (/^\s*[a-zA-Z_]\w*\s*$/.test(body)) names.add(body.trim());
    } else {
      names.add(body.slice(0, comma).trim());
      // option texts of plural/select: "one {…} other {…}" — recurse into each
      const rest = body.slice(comma + 1);
      const opts = rest.slice(rest.indexOf(",") + 1);
      let j = 0;
      while (j < opts.length) {
        const ob = opts.indexOf("{", j);
        if (ob === -1) break;
        const cb = matchBrace(opts, ob);
        if (cb === -1) break;
        placeholders(opts.slice(ob + 1, cb), names);
        j = cb + 1;
      }
    }
    i = close + 1;
  }
  return names;
}

function pluralBlocksMissingOther(msg) {
  const problems = [];
  const re = /\{\s*([a-zA-Z_]\w*)\s*,\s*(plural|select)\s*,/g;
  let m;
  while ((m = re.exec(msg))) {
    // find the matching closing brace of this block
    let depth = 0;
    let end = -1;
    for (let i = m.index; i < msg.length; i++) {
      if (msg[i] === "{") depth++;
      else if (msg[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const body = end === -1 ? msg.slice(m.index) : msg.slice(m.index, end);
    if (!/\bother\s*\{/.test(body)) problems.push(`${m[2]} block for {${m[1]}} has no "other" branch`);
  }
  return problems;
}

function loadCatalogs() {
  const files = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
  const catalogs = {};
  for (const f of files) {
    const locale = f.replace(/\.json$/, "");
    try {
      catalogs[locale] = JSON.parse(readFileSync(join(MESSAGES_DIR, f), "utf8"));
    } catch (e) {
      console.error(`✖ ${f}: invalid JSON — ${e.message}`);
      process.exit(1);
    }
  }
  return catalogs;
}

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
    // ignore examples in comments
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

const catalogs = loadCatalogs();
if (!catalogs[SOURCE]) {
  console.error(`✖ missing source catalog src/messages/${SOURCE}.json`);
  process.exit(1);
}

const flat = Object.fromEntries(Object.entries(catalogs).map(([l, c]) => [l, flatten(c)]));
const sourceKeys = Object.keys(flat[SOURCE]);
const report = {};
let errorCount = 0;
let warnCount = 0;

for (const [locale, entries] of Object.entries(flat)) {
  const errors = [];
  const warnings = [];
  const keys = new Set(Object.keys(entries));

  for (const key of sourceKeys) {
    if (!keys.has(key)) {
      errors.push(`missing key: ${key}`);
      continue;
    }
    const value = entries[key];
    const en = flat[SOURCE][key];
    if (typeof value !== "string") {
      errors.push(`not a string: ${key}`);
      continue;
    }
    if (!value.trim()) errors.push(`empty value: ${key}`);
    const a = placeholders(en);
    const b = placeholders(value);
    const missing = [...a].filter((x) => !b.has(x));
    const extra = [...b].filter((x) => !a.has(x));
    if (missing.length) errors.push(`placeholder(s) {${missing.join("}, {")}} missing in ${key}`);
    if (extra.length) errors.push(`unknown placeholder(s) {${extra.join("}, {")}} in ${key}`);
    for (const p of pluralBlocksMissingOther(value)) errors.push(`${key}: ${p}`);
    if (locale === "de" && value.includes("ß")) errors.push(`"ß" in ${key} (Swiss German uses "ss")`);
    if (locale !== SOURCE && value === en && !SAME_AS_EN_OK.has(key) && /[a-z]{3,}/i.test(value)) {
      warnings.push(`same as English (untranslated?): ${key} = "${value}"`);
    }
  }
  for (const key of keys) {
    if (!(key in flat[SOURCE])) errors.push(`extra key not in ${SOURCE}.json: ${key}`);
  }
  report[locale] = { keys: keys.size, errors, warnings };
  errorCount += errors.length;
  warnCount += warnings.length;
}

const usage = usedKeys();
const unknownUsage = [...usage.entries()].filter(([k]) => !(k in flat[SOURCE]));
for (const [k, file] of unknownUsage) {
  (report._source ??= { keys: usage.size, errors: [], warnings: [] }).errors.push(`t("${k}") in ${file} is not in ${SOURCE}.json`);
  errorCount++;
}

if (JSON_OUT) {
  console.log(JSON.stringify({ errors: errorCount, warnings: warnCount, locales: report }, null, 2));
} else {
  console.log(`i18n check — source: ${SOURCE}.json (${sourceKeys.length} keys), locales: ${Object.keys(catalogs).join(", ")}`);
  console.log(`literal t() keys used in src/: ${usage.size}`);
  for (const [locale, r] of Object.entries(report)) {
    const status = r.errors.length ? "✖" : r.warnings.length ? "!" : "✔";
    console.log(`\n${status} ${locale}: ${r.keys} keys, ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
    for (const e of r.errors) console.log(`   ✖ ${e}`);
    for (const w of r.warnings) console.log(`   ! ${w}`);
  }
  console.log(`\n${errorCount} error(s), ${warnCount} warning(s).`);
}

process.exit(errorCount > 0 || (STRICT && warnCount > 0) ? 1 : 0);

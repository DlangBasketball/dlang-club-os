/**
 * Shared helpers for the i18n scripts (check, sync, coverage, export, import).
 * Zero dependencies. The registry and the overlay transforms are the app's own
 * TypeScript modules, loaded through Node's built-in type stripping.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MESSAGES_DIR = join(ROOT, "src", "messages");
export const OVERLAY_SOURCES_DIR = join(MESSAGES_DIR, "overlays");
export const SRC_DIR = join(ROOT, "src");

const registry = await import(join(ROOT, "src", "lib", "i18n", "languages.ts"));
const transforms = await import(join(ROOT, "src", "lib", "i18n", "overlay-transforms.ts"));

export const { LANGUAGES, SOURCE_LOCALE, fallbackChain, catalogChain } = registry;
export const { buildOverlay, mapMessageText, swissGerman, britishEnglish } = transforms;

/** Registry entries that ship a catalog file. */
export const CATALOG_LANGUAGES = LANGUAGES.filter((l) => l.status !== "none");

export function catalogPath(tag) {
  return join(MESSAGES_DIR, `${tag}.json`);
}

export function termsPath(tag) {
  return join(OVERLAY_SOURCES_DIR, `${tag}.terms.json`);
}

export function readJson(file, fallback = undefined) {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${file}`);
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: invalid JSON — ${e.message}`);
  }
}

export function stringifyCatalog(tree) {
  return JSON.stringify(tree, null, 2) + "\n";
}

export function writeJson(file, tree) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stringifyCatalog(tree));
}

/** Catalog files present on disk (tag -> tree). */
export function loadCatalogFiles() {
  const out = {};
  for (const f of readdirSync(MESSAGES_DIR)) {
    if (!f.endsWith(".json")) continue;
    out[f.replace(/\.json$/, "")] = readJson(join(MESSAGES_DIR, f));
  }
  return out;
}

/** Flatten nested JSON into { "a.b.c": value }. */
export function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** Inverse of flatten, keeping the order of `orderKeys` (the English key order). */
export function unflatten(flat, orderKeys = Object.keys(flat)) {
  const out = {};
  const keys = [...orderKeys.filter((k) => k in flat), ...Object.keys(flat).filter((k) => !orderKeys.includes(k))];
  for (const key of keys) {
    const parts = key.split(".");
    let node = out;
    for (const p of parts.slice(0, -1)) {
      if (!node[p] || typeof node[p] !== "object") node[p] = {};
      node = node[p];
    }
    node[parts[parts.length - 1]] = flat[key];
  }
  return out;
}

/**
 * Effective flat catalog for a tag: the catalog chain merged most general
 * first (en <- de <- de-CH), as the app's loader does.
 */
export function effectiveCatalog(tag, files) {
  const chain = [...catalogChain(tag)].reverse();
  const out = {};
  for (const t of chain) {
    for (const [k, v] of Object.entries(flatten(files[t] ?? {}))) {
      if (typeof v === "string" && v.trim() !== "") out[k] = v;
    }
  }
  return out;
}

function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Variable names in an ICU-lite message: {name}, {count, plural, …} (recursing into options). */
export function placeholders(msg, names = new Set()) {
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

export function pluralBlocksMissingOther(msg) {
  const problems = [];
  const re = /\{\s*([a-zA-Z_]\w*)\s*,\s*(plural|select)\s*,/g;
  let m;
  while ((m = re.exec(msg))) {
    const end = matchBrace(msg, m.index);
    const body = end === -1 ? msg.slice(m.index) : msg.slice(m.index, end);
    if (!/\bother\s*\{/.test(body)) problems.push(`${m[2]} block for {${m[1]}} has no "other" branch`);
  }
  return problems;
}

/** Compare two messages' placeholders: { missing, extra }. */
export function placeholderDiff(source, target) {
  const a = placeholders(source);
  const b = placeholders(target);
  return { missing: [...a].filter((x) => !b.has(x)), extra: [...b].filter((x) => !a.has(x)) };
}

/**
 * Keys allowed to stay identical to English (brand names, international
 * words, pure placeholders). Shared by the checker and the coverage report.
 */
export const SAME_AS_EN_OK = new Set([
  "meta.direction",
  "shell.clubOs",
  "registration.review.lineItem",
  "payments.methods.twint",
  "finance.methods.twint",
  "notifications.channels.push",
  "notifications.channels.sms",
  "messaging.preferences.push",
  "booking.duration",
  "training.common.minutes",
  "website.widgets.duration",
  "camps.seasons.label",
  "camps.seasons.campNames.other",
  "editPeople.consents.version",
  "payments.taxLine",
  "website.social.facebook",
  "website.social.instagram",
  "website.social.youtube",
  "website.social.tiktok",
  "website.social.linkedin",
  "website.admin.embed.iframe",
  "website.admin.embed.widget",
  "website.nav.camps",
  "website.nav.shop",
  "website.kinds.camp",
  "website.sections.camps",
  "website.sections.shop",
  "website.widgetNames.shop",
  "website.admin.flags.public",
  "website.admin.flags.photo",
  "programKind.camp",
  "programKind.clinic",
  "clubadmin.common.status",
  "clubadmin.incidents.status",
  "clubadmin.compliance.team",
  "clubadmin.incidents.team",
  "clubadmin.membership.statuses.active",
  "clubadmin.waitlist.kinds.program",
  "clubadmin.js.title",
  "family.push.event.types.training",
  "family.placement.status",
  "family.placement.kind",
  "family.placement.kinds.club",
  "family.placement.kinds.college",
  "family.placement.documents",
  "family.scout.fieldNames.position",
  "family.scout.fieldNames.teams",
  "family.privacy.export.sections.documents",
  "family.pages.privacy.notifications",
  "accounting.common.date",
  "accounting.support.funders.canton",
  "camps.seasons.names.winter",
  "editMoney.adjust.kind",
  "editMoney.common.actions",
  "editMoney.common.date",
  "editMoney.common.note",
  "editMoney.invoice.description",
  "editMoney.invoice.lineDescription",
  "editMoney.invoice.notes",
  "editMoney.invoice.total",
  "editMoney.payment.note",
  "editMoney.payment.stripe",
  "editMoney.training.categories.mental",
  "editMoney.training.categories.nutrition",
  "editMoney.training.categories.personal",
  "editMoney.training.kindLabel",
  "editPeople.optional",
  "editPeople.consentSource.verbal",
  "editPeople.athlete.status",
  "editPeople.programmes.status",
  "editPeople.programmes.teams",
  "editPeople.registrations.status",
  "editPeople.consentSource.online",
  "editPeople.medical.allergies",
  "editPeople.registrations.program",
  "editPeople.documents.kind",
  "editPeople.documentKind.photo",
  "editPeople.documentScope.program",
  "athletePhoto.title",
  "auth.statusLabel",
  "nav.import",
  "nav.teams",
  "common.status",
  "nav.training",
  "training.book.stepService",
  "training.common.status",
  "training.groups.participants",
  "training.profile.link",
  "training.profile.pageTitle",
  "common.total",
  "common.date",
  "common.name",
  "common.notes",
  "common.actions",
  "common.no",
  "nav.assistant",
  "aiAssistant.pageTitle",
  "nav.documents",
  "nav.notifications",
  "nav.home",
  "nav.account",
  "shell.notifications",
  "status.open",
  "invoices.total",
  "notifications.title",
  "notifications.types.system",
  "parentHome.notifications",
  "roles.parent",
  "email.adminRegistrationAlert.parent",
  "common.optional",
  "common.subtotal",
  "registration.consents.optional",
  "nav.invitations",
  "finance.common.date",
  "finance.common.actions",
  "finance.expenses.program",
  "finance.payouts.minutes",
  "finance.reports.total",
  // per language ("tag:key"): correct in that language only
  "es:training.service.color",
  "es:shop.admin.color",
  // invoice PDF / QR-bill: currency codes and international words
  "pdf.invoice.qty",
  "pdf.qrBill.currency",
  "languageSettings.regionCode",
]);

/** A value counts as translated when it differs from English, is allow-listed, or has no words. */
export function isTranslated(key, value, english, tag = "") {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value !== english) return true;
  return SAME_AS_EN_OK.has(key) || SAME_AS_EN_OK.has(`${tag}:${key}`) || !/[a-z]{3,}/i.test(value);
}

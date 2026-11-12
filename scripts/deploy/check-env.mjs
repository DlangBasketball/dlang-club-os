#!/usr/bin/env node
/**
 * Pre-deploy environment check. Prints variable NAMES only, never values.
 *
 *   node scripts/deploy/check-env.mjs                 # checks process.env
 *   node scripts/deploy/check-env.mjs .env.production # checks a dotenv file
 *   APP_ENV=production node scripts/deploy/check-env.mjs .env.production
 *
 * Exit code 1 when a required variable is missing/invalid, so it can gate CI.
 * Mirrors src/lib/observability/env-check.ts (keep both in sync).
 */
import { readFileSync } from "node:fs";

function loadDotenv(path) {
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const file = process.argv[2];
const env = file ? { ...loadDotenv(file), ...(process.env.APP_ENV ? { APP_ENV: process.env.APP_ENV } : {}) } : process.env;
const has = (k) => typeof env[k] === "string" && env[k].trim() !== "";
const appEnv = env.APP_ENV || "local";
const prod = appEnv === "production";

const ALWAYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const PROD = ["NEXT_PUBLIC_SITE_URL", "APP_ENV", "DATA_REGION", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "RESEND_FROM"];
const PATTERNS = {
  NEXT_PUBLIC_SUPABASE_URL: /^https?:\/\//,
  NEXT_PUBLIC_SITE_URL: prod ? /^https:\/\// : /^https?:\/\//,
  STRIPE_SECRET_KEY: /^(sk|rk)_(test|live)_/,
  STRIPE_WEBHOOK_SECRET: /^whsec_/,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: /^pk_(test|live)_/,
  RESEND_API_KEY: /^re_/,
  APP_ENV: /^(local|staging|production)$/,
  DATA_REGION: /^(eu|us)$/,
  LOG_LEVEL: /^(debug|info|warn|error)$/,
  SENTRY_DSN: /^https:\/\/[^@]+@/,
};

const problems = [];
const warnings = [];
for (const k of [...ALWAYS, ...(prod ? PROD : [])]) if (!has(k)) problems.push(`missing ${k}`);
for (const [k, re] of Object.entries(PATTERNS)) if (has(k) && !re.test(env[k].trim())) problems.push(`invalid ${k}`);
for (const [k, v] of Object.entries(env)) {
  if (k.startsWith("NEXT_PUBLIC_") && typeof v === "string" && /service_role|sk_live|sk_test|whsec_|re_[A-Za-z0-9]{8}/.test(v))
    problems.push(`${k} looks like it contains a secret`);
}
if (prod && has("STRIPE_SECRET_KEY") && env.STRIPE_SECRET_KEY.includes("_test_")) warnings.push("STRIPE_SECRET_KEY is a test key");
if (!prod && has("STRIPE_SECRET_KEY") && env.STRIPE_SECRET_KEY.includes("_live_")) warnings.push(`STRIPE_SECRET_KEY is a LIVE key in ${appEnv}`);
if (prod && !has("SENTRY_DSN")) warnings.push("SENTRY_DSN not set (errors only in logs)");
if (prod && !has("HEALTH_CHECK_TOKEN")) warnings.push("HEALTH_CHECK_TOKEN not set");
if (has("DATA_REGION") && has("NEXT_PUBLIC_SUPABASE_URL") && env.DATA_REGION === "us" && /eu|frankfurt|zurich/i.test(env.NEXT_PUBLIC_SUPABASE_URL))
  warnings.push("DATA_REGION=us but the Supabase URL looks European — double-check the region mapping");

console.log(`Environment check (${appEnv}${file ? `, ${file}` : ""})`);
for (const w of warnings) console.log(`  WARN  ${w}`);
for (const p of problems) console.log(`  FAIL  ${p}`);
if (problems.length === 0) console.log("  OK    all required variables present");
process.exit(problems.length ? 1 : 0);

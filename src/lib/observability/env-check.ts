import { z } from "zod";
import { appEnvironment } from "./build-info";

/**
 * Zod schema for EVERY environment variable the app reads.
 *
 * This complements src/lib/env.ts (lazy getters used by feature code). It is
 * deliberately NON-throwing so it is safe at `next build` time, when secrets
 * are usually absent: call `checkEnv()` to get a report, and decide what to do
 * with it (the /api/health endpoint marks the deployment "degraded"; the
 * scripts/deploy/check-env.mjs pre-flight fails the deploy).
 *
 * Keep in sync with .env.example.
 */
const optionalStr = z.string().trim().min(1).optional();
const url = z.string().trim().url();

export const envSchema = z.object({
  // --- Supabase (one project per data region) ---
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(20),
  SUPABASE_PROJECT_ID: optionalStr,
  // --- App / platform ---
  NEXT_PUBLIC_SITE_URL: url.optional(),
  APP_ENV: z.enum(["local", "staging", "production"]).optional(),
  DATA_REGION: z.enum(["eu", "us"]).optional(),
  PLATFORM_ROOT_DOMAIN: optionalStr,
  CLUB_ADMIN_EMAIL: z.string().trim().email().optional(),
  // --- Payments ---
  STRIPE_SECRET_KEY: z.string().trim().regex(/^(sk|rk)_(test|live)_/, "must start with sk_test_/sk_live_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().trim().regex(/^whsec_/, "must start with whsec_").optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().trim().regex(/^pk_(test|live)_/).optional(),
  // --- Email ---
  RESEND_API_KEY: z.string().trim().regex(/^re_/, "must start with re_").optional(),
  RESEND_FROM: optionalStr,
  // --- AI assistant (optional) ---
  ANTHROPIC_API_KEY: optionalStr,
  ANTHROPIC_MODEL: optionalStr,
  // --- Observability / ops ---
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  SENTRY_DSN: url.optional(),
  SENTRY_ENVIRONMENT: optionalStr,
  HEALTH_CHECK_TOKEN: z.string().trim().min(16).optional(),
  APP_VERSION: optionalStr,
  GIT_SHA: optionalStr,
  // --- Custom domains automation (optional) ---
  VERCEL_API_TOKEN: optionalStr,
  VERCEL_PROJECT_ID: optionalStr,
  VERCEL_TEAM_ID: optionalStr,
});

export type EnvShape = z.infer<typeof envSchema>;

/** Vars that are optional in code but MUST be set for a production deployment. */
const REQUIRED_IN_PRODUCTION = [
  "NEXT_PUBLIC_SITE_URL",
  "APP_ENV",
  "DATA_REGION",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM",
] as const;

export type EnvReport = {
  ok: boolean;
  /** Variable NAMES only — never values. */
  missing: string[];
  invalid: { name: string; issue: string }[];
  warnings: string[];
};

export function checkEnv(source: Record<string, string | undefined> = process.env): EnvReport {
  // Treat empty strings as unset.
  const input: Record<string, string> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const v = source[key];
    if (typeof v === "string" && v.trim() !== "") input[key] = v;
  }
  const missing: string[] = [];
  const invalid: EnvReport["invalid"] = [];
  const warnings: string[] = [];

  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0]);
      if (!(name in input)) missing.push(name);
      else invalid.push({ name, issue: issue.message });
    }
  }

  const isProd = (source.APP_ENV ?? appEnvironment()) === "production";
  if (isProd) {
    for (const name of REQUIRED_IN_PRODUCTION) if (!(name in input)) missing.push(name);
    if (input.STRIPE_SECRET_KEY?.includes("_test_")) warnings.push("STRIPE_SECRET_KEY is a TEST key in production");
    if (input.NEXT_PUBLIC_SITE_URL && !input.NEXT_PUBLIC_SITE_URL.startsWith("https://"))
      invalid.push({ name: "NEXT_PUBLIC_SITE_URL", issue: "must be https:// in production" });
    if (!input.SENTRY_DSN) warnings.push("SENTRY_DSN not set — errors only go to logs");
  }
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith("NEXT_PUBLIC_") && /service_role|sk_live|sk_test|whsec_|re_[A-Za-z0-9]{8}/.test(v))
      invalid.push({ name: k, issue: "public variable appears to contain a secret" });
  }

  const uniqMissing = Array.from(new Set(missing));
  return { ok: uniqMissing.length === 0 && invalid.length === 0, missing: uniqMissing, invalid, warnings };
}

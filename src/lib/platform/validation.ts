import { z } from "zod";
import { CURRENCIES, FEATURE_KEYS, INTERVALS, LOCALES } from "./catalog";

/**
 * Input validation for signup + platform console. Mirrors the checks inside
 * the SQL functions (which remain the real boundary) so users get friendly
 * errors before a round-trip.
 */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

export const RESERVED_SLUGS = new Set([
  "admin", "administrator", "api", "app", "apps", "auth", "billing", "blog", "coach", "dashboard",
  "docs", "help", "login", "logout", "mail", "new", "onboarding", "parent", "platform", "pricing",
  "register", "root", "settings", "signup", "signin", "static", "status", "support", "system",
  "www", "assets", "cdn", "club", "clubs", "console", "demo", "test", "staging", "dev",
]);

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/g, "");
}

export function slugProblem(slug: string): string | null {
  if (!SLUG_RE.test(slug) || slug.includes("--")) {
    return "3–48 characters: lowercase letters, digits and single hyphens (not at the start or end).";
  }
  if (RESERVED_SLUGS.has(slug)) return "This address is reserved. Please choose another.";
  return null;
}

export const tenantSignupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(120, "Name is too long")
    .refine((v) => !/[<>{}\\]/.test(v), "Name contains invalid characters"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((v, ctx) => {
      const p = slugProblem(v);
      if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p });
    }),
  sport: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/, "Pick a sport"),
  country: z.string().regex(/^[A-Z]{2}$/, "Pick a country"),
  currency: z.enum(CURRENCIES as [string, ...string[]]),
  locale: z.enum(LOCALES.map((l) => l.value) as [string, ...string[]]).default("en"),
  fullName: z.string().trim().max(120).optional().default(""),
  plan: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/).default("club"),
});
export type TenantSignupInput = z.infer<typeof tenantSignupSchema>;

/** Friendly messages for the error codes raised by provision_tenant(). */
export const PROVISION_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please confirm your email first — your session has expired.",
  PROFILE_MISSING: "Your account is still being set up. Please try again in a moment.",
  ALREADY_MEMBER:
    "This email already belongs to a club. Sign out and use a different email to create a new organization.",
  INVALID_NAME: "Please enter a valid organization name.",
  INVALID_SLUG: "That web address isn't valid.",
  SLUG_RESERVED: "That web address is reserved. Please choose another.",
  SLUG_TAKEN: "That web address is already taken. Please choose another.",
  INVALID_SPORT: "Please pick a sport.",
  INVALID_COUNTRY: "Please pick a country.",
  INVALID_CURRENCY: "Please pick CHF, EUR or USD.",
  INVALID_LOCALE: "Please pick a language.",
  INVALID_FULL_NAME: "Your name is too long.",
  INVALID_PLAN: "That plan can't be selected online — contact sales for Multi-site & Federation.",
};

/** Extracts the SQL error code (e.g. SLUG_TAKEN) from a PostgREST error message. */
export function sqlErrorCode(message: string | undefined | null): string | null {
  if (!message) return null;
  const m = message.match(/\b([A-Z][A-Z_]{3,})\b/);
  return m ? m[1] : null;
}

export function friendlyError(message: string | undefined | null, map: Record<string, string> = PROVISION_ERRORS) {
  const code = sqlErrorCode(message);
  return (code && map[code]) || "Something went wrong. Please try again.";
}

const optionalInt = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a whole number ≥ 0" });
      return z.NEVER;
    }
    return n;
  });

const optionalAmount = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid amount" });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

export const planPriceSchema = z.object({
  currency: z.enum(CURRENCIES as [string, ...string[]]),
  billing_interval: z.enum(INTERVALS as [string, ...string[]]),
  amount: optionalAmount,
  onboarding_fee: optionalAmount,
  stripe_price_id: z
    .string()
    .trim()
    .max(100)
    .refine((v) => v === "" || /^price_[A-Za-z0-9]+$/.test(v), "Stripe price ids look like price_…")
    .optional()
    .default(""),
});

export const planSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,31}$/, "Code: lowercase letters, digits, underscores"),
  name: z.string().trim().min(2).max(60),
  tagline: z.string().trim().max(160).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  audience: z.string().trim().max(120).optional().default(""),
  sort_order: z.coerce.number().int().min(0).max(10_000).default(0),
  is_public: z.boolean().default(true),
  is_active: z.boolean().default(true),
  is_custom: z.boolean().default(false),
  trial_days: z.coerce.number().int().min(0).max(90).default(14),
  max_athletes: optionalInt,
  max_staff: optionalInt,
  features: z.record(z.string(), z.boolean()).transform((f) => {
    const out: Record<string, boolean> = {};
    for (const k of FEATURE_KEYS) out[k] = Boolean(f[k]);
    return out;
  }),
  prices: z.array(planPriceSchema).max(6),
});
export type PlanInput = z.infer<typeof planSchema>;

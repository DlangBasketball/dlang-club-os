/**
 * Prospect demo sandboxes: configuration and pure helpers (no I/O, unit
 * tested in tests/unit/demo-sandbox.test.ts). See docs/demo/PROSPECT_DEMO.md.
 *
 * The demo runs only on a non-production deployment that sets
 * DEMO_SANDBOX_ENABLED=true (the env check refuses the flag in production and
 * refuses a live Stripe key while it is on).
 */
import { createHash, randomBytes } from "node:crypto";

export const DEMO_ROLES = ["parent", "admin", "coach", "player", "finance"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

/** First screen for each role after "Start". */
export const DEMO_ROLE_HOME: Record<DemoRole, string> = {
  parent: "/parent/home",
  admin: "/admin/approvals",
  coach: "/coach/team",
  player: "/player",
  finance: "/admin/invoices",
};

/**
 * Fictional people of the seeded scenario (data, not UI copy: the same names
 * the migration seeds). Admin and finance have no persona; the page shows
 * their translated role title instead.
 */
export const DEMO_PERSONAS: Partial<Record<DemoRole, string>> = {
  parent: "Jamie Morgan",
  coach: "Coach Taylor",
  player: "Alex Morgan",
};

/** httpOnly cookie carrying the prospect's sandbox token (the hash is stored). */
export const DEMO_COOKIE = "clubos_demo";
export const DEMO_TTL_HOURS = 24;
const DEFAULT_MAX_PER_HOUR = 30;

/** Reserved domain of every demo login and every e-mail in a demo club. */
export const DEMO_EMAIL_DOMAIN = "demo.example.com";

type Env = Record<string, string | undefined>;

export function demoEnabled(env: Env = process.env): boolean {
  if (env.DEMO_SANDBOX_ENABLED !== "true") return false;
  const appEnv = (env.APP_ENV ?? "").trim();
  if (appEnv === "production") return false;
  if (!appEnv && (env.VERCEL_ENV ?? "").trim() === "production") return false;
  return true;
}

export function demoMaxPerHour(env: Env = process.env): number {
  const n = Number.parseInt(env.DEMO_MAX_SANDBOXES_PER_HOUR ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_PER_HOUR;
}

/** Approved "Book a walkthrough" URL (https only), or null when not configured. */
export function demoWalkthroughUrl(env: Env = process.env): string | null {
  const v = (env.DEMO_WALKTHROUGH_URL ?? "").trim();
  try {
    return v && new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

export function isDemoRole(v: unknown): v is DemoRole {
  return typeof v === "string" && (DEMO_ROLES as readonly string[]).includes(v);
}

/** New random sandbox token (256 bits, base64url). */
export function newDemoToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Stored form of a token: lowercase hex SHA-256 (matches the DB check). */
export function hashDemoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A cookie value worth looking up: base64url, 43 chars for 32 bytes. */
export function isWellFormedDemoToken(v: string | undefined | null): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

/** Login e-mail of one role in one sandbox (unique, reserved domain). */
export function demoLoginEmail(sandboxKey: string, role: DemoRole): string {
  const key = sandboxKey.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  return `demo-${key}-${role}@${DEMO_EMAIL_DOMAIN}`;
}

/**
 * True for an address of the demo domain. Every demo login and every e-mail
 * address seeded in a demo club uses it, so the e-mail layer drops demo mail
 * before it reaches the provider (even with EMAIL_TEST_REDIRECT set).
 */
export function isDemoEmail(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 0) return false;
  const domain = address.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  return domain === DEMO_EMAIL_DOMAIN || domain.endsWith(`.${DEMO_EMAIL_DOMAIN}`);
}

/** Same-origin check for the demo POST routes (CSRF): Origin must match Host. */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

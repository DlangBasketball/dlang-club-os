import { createHmac } from "node:crypto";

/**
 * Spam protection for the public "Questions? Contact us" form, captcha-free:
 *   - a honeypot field humans never see (bots fill it)
 *   - a minimum fill time (bots post instantly)
 *   - a rate limit per hashed client IP and per club; the same limits are
 *     enforced inside public.contact_lead_submit() (keep both in sync with
 *     public.contact_lead_limits()).
 * The client IP is never stored: only an HMAC of (club, IP) with a server
 * secret, so the hash cannot be reversed or linked across clubs.
 */

export const LEAD_LIMITS = { perIp10Min: 3, perIpDay: 10, perOrgHour: 100 } as const;

/** Submissions faster than this (ms after the form rendered) count as bots. */
export const MIN_FILL_MS = 2500;

export type LeadCounts = { ipLast10Min: number; ipLastDay: number; orgLastHour: number };
export type RateDecision = { allowed: true } | { allowed: false; reason: "ip_burst" | "ip_daily" | "club_hourly" };

export function leadRateDecision(c: LeadCounts, limits: typeof LEAD_LIMITS = LEAD_LIMITS): RateDecision {
  if (c.ipLast10Min >= limits.perIp10Min) return { allowed: false, reason: "ip_burst" };
  if (c.ipLastDay >= limits.perIpDay) return { allowed: false, reason: "ip_daily" };
  if (c.orgLastHour >= limits.perOrgHour) return { allowed: false, reason: "club_hourly" };
  return { allowed: true };
}

/** First client address from proxy headers ("x-forwarded-for: client, proxy1"). */
export function clientIpFrom(get: (name: string) => string | null): string | null {
  const fwd = get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = get("x-real-ip")?.trim();
  const ip = fwd || real || "";
  return ip && ip.length <= 64 ? ip : null;
}

/** HMAC-SHA256(secret, orgId|ip) as hex; null without an IP. */
export function hashClientIp(ip: string | null, orgId: string, secret: string): string | null {
  if (!ip) return null;
  return createHmac("sha256", secret || "contact-form").update(`${orgId}|${ip}`).digest("hex");
}

/**
 * Honeypot + time trap. `honeypot` is the hidden field's value; `renderedAt`
 * is the epoch ms the form was rendered (a hidden field), `now` the server time.
 */
export function looksLikeBot(honeypot: string | null | undefined, renderedAt: number | null | undefined, now: number): boolean {
  if (honeypot && honeypot.trim() !== "") return true;
  if (typeof renderedAt !== "number" || !Number.isFinite(renderedAt)) return true;
  const elapsed = now - renderedAt;
  return elapsed < MIN_FILL_MS || elapsed > 1000 * 60 * 60 * 24;
}

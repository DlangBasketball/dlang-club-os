import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Webhook signing for the website connection (contract:
 * docs/website/PUBLIC_API_CONTRACT.md). The app POSTs a JSON body with
 *   X-DLang-Signature: sha256=<hex HMAC-SHA256 of the raw body with the club's secret>
 *   X-DLang-Timestamp: <unix seconds>
 * The website (WordPress plugin) recomputes the HMAC over the exact raw body.
 */

export const SIGNATURE_HEADER = "X-DLang-Signature";
export const TIMESTAMP_HEADER = "X-DLang-Timestamp";
export const SECRET_PREFIX = "dlws_";

export function signBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** Constant-time check of a received signature header (used in tests and by any receiver written in TS). */
export function verifySignature(secret: string, rawBody: string, header: string | null | undefined): boolean {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(signBody(secret, rawBody));
  const got = Buffer.from(header.trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** New random signing secret (shown to the admin once). 32 bytes of entropy. */
export function generateSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("hex")}`;
}

/** Last characters of a secret, safe to show in the admin ("…a1b2"). */
export function secretHint(secret: string): string {
  return secret.slice(-4);
}

export type ContentUpdatedPayload = { type: "content.updated"; resource: string; club: string; at: string };

/** Exact JSON body of a content-updated webhook (stable key order). */
export function contentUpdatedBody(resource: string, club: string, at: Date): string {
  const payload: ContentUpdatedPayload = { type: "content.updated", resource, club, at: at.toISOString() };
  return JSON.stringify(payload);
}

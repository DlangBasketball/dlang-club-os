import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Guardian consent link token: 32 random bytes (base64url) sent only in the
 * e-mail; the database stores the SHA-256 hex digest. Generated on the server,
 * never returned to the booker's browser.
 */
export function newConsentToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashConsentToken(token) };
}

export function hashConsentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Shape check before hashing a token from a URL (43 base64url characters). */
export function isConsentToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

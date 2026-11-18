import { createHash, randomBytes } from "node:crypto";

/**
 * Scout link tokens: 32 random bytes (base64url) in the link; only the
 * SHA-256 hash is stored, so a database read never yields a working link.
 * Re-publishing issues a new token and the old link stops working.
 */
export function generateScoutToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashScoutToken(token) };
}

export function hashScoutToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Shape check before hashing a token from a URL (43 base64url chars). */
export function isScoutTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

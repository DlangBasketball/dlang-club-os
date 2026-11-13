import { createHmac, timingSafeEqual } from "node:crypto";
import { parseToken } from "./token";

/**
 * TypeScript twin of public.member_card_sign(): used by tests and tools to
 * check the database's algorithm. The club keys never leave the database, so
 * the app itself resolves tokens through public.resolve_member_token().
 */
export function signNonce(nonce: string, version: number, key: string): string {
  return createHmac("sha256", key).update(`${nonce}.${version}`).digest("hex").slice(0, 32);
}

export function buildToken(nonce: string, version: number, key: string): string {
  return `M1.${nonce}.${signNonce(nonce, version, key)}`;
}

/** Constant-time check of a token against a nonce version and key. */
export function verifyToken(token: string, version: number, key: string): boolean {
  const p = parseToken(token);
  if (!p) return false;
  const expected = Buffer.from(signNonce(p.nonce, version, key), "utf8");
  const given = Buffer.from(p.signature, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Member card tokens (QR code / NFC tag): format helpers, shared by the
 * scanner (client), the server actions and the unit tests.
 *
 *   M1.<nonce: 32 hex>.<signature: 32 hex>
 *   signature = first 32 hex chars of HMAC-SHA256(`${nonce}.${version}`, club key)
 *
 * The token carries no personal data. The database signs and verifies with
 * the club's key (public.member_card_sign / resolve_member_token); a rotation
 * issues a new nonce. Bracelets without a stored token are matched by their
 * serial number (hex, separators ignored).
 */
export const TOKEN_RE = /^M1\.[0-9a-f]{32}\.[0-9a-f]{32}$/;

export type ParsedToken = { nonce: string; signature: string };

/** Extract a card token from scanned text (a bare token or a URL / text containing one). */
export function extractToken(raw: string | null | undefined): string | null {
  const m = /M1\.[0-9a-f]{32}\.[0-9a-f]{32}/.exec((raw ?? "").trim());
  return m ? m[0] : null;
}

export function parseToken(token: string): ParsedToken | null {
  if (!TOKEN_RE.test(token)) return null;
  const [, nonce, signature] = token.split(".");
  return { nonce, signature };
}

/** NFC serial "04:a2:2b:1c" -> "04A22B1C"; null when not a plausible tag id. */
export function normalizeTagId(raw: string | null | undefined): string | null {
  const hex = (raw ?? "").replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  return hex.length >= 4 && hex.length <= 40 ? hex : null;
}

/** What to send to the resolver for a scan: a card token, else a tag id. */
export function scanPayload(raw: string | null | undefined): string | null {
  return extractToken(raw) ?? (/^[0-9A-Fa-f:\s-]{4,60}$/.test((raw ?? "").trim()) ? normalizeTagId(raw) : null);
}

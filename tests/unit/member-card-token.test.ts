import { describe, expect, it } from "vitest";
import { buildToken, signNonce, verifyToken } from "@/lib/member-cards/sign";
import { extractToken, normalizeTagId, parseToken, scanPayload } from "@/lib/member-cards/token";

const NONCE = "0123456789abcdef0123456789abcdef";
const KEY = "00112233";

describe("member card tokens", () => {
  it("signs like public.member_card_sign (shared test vector in tests/db/shop_search.sql)", () => {
    expect(signNonce(NONCE, 1, KEY)).toBe("a74be9e8ca6189f3f8cef3d728898d5a");
    expect(buildToken(NONCE, 1, KEY)).toBe(`M1.${NONCE}.a74be9e8ca6189f3f8cef3d728898d5a`);
  });

  it("verifies a token; another version, key or a tampered signature fails", () => {
    const tok = buildToken(NONCE, 3, KEY);
    expect(verifyToken(tok, 3, KEY)).toBe(true);
    expect(verifyToken(tok, 2, KEY)).toBe(false);
    expect(verifyToken(tok, 3, "other")).toBe(false);
    expect(verifyToken(tok.slice(0, -1) + (tok.endsWith("0") ? "1" : "0"), 3, KEY)).toBe(false);
    expect(verifyToken("M1.short.sig", 3, KEY)).toBe(false);
  });

  it("carries no personal data and parses strictly", () => {
    const tok = buildToken(NONCE, 1, KEY);
    expect(parseToken(tok)).toEqual({ nonce: NONCE, signature: tok.split(".")[2] });
    expect(parseToken("M1.ABC.def")).toBeNull();
    expect(tok).toMatch(/^M1\.[0-9a-f]{32}\.[0-9a-f]{32}$/);
  });

  it("extracts a token from scanned text and normalises NFC serials", () => {
    const tok = buildToken(NONCE, 1, KEY);
    expect(extractToken(`https://club.example/c/${tok}`)).toBe(tok);
    expect(extractToken("hello")).toBeNull();
    expect(normalizeTagId("04:a2:2b:1c:5d:80")).toBe("04A22B1C5D80");
    expect(normalizeTagId("12")).toBeNull();
    expect(scanPayload(tok)).toBe(tok);
    expect(scanPayload("04:a2:2b:1c")).toBe("04A22B1C");
    expect(scanPayload("Lucas Müller")).toBeNull();
  });
});

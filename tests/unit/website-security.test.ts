import { describe, expect, it } from "vitest";
import {
  corsHeaders, embedParentOrigin, frameAncestorsCsp, isAllowedOrigin, normalizeOrigin, parseOriginList, safeReturnTo,
} from "@/lib/website/origins";
import { contentUpdatedBody, generateSecret, signBody, verifySignature } from "@/lib/website/hmac";
import { openSecret, sealSecret } from "@/lib/website/secret-box";
import { MAX_ATTEMPTS, isPermanentFailure, nextAttemptAt } from "@/lib/website/webhook-schedule";
import { createRateLimiter, clientIp } from "@/lib/website/rate-limit";
import { publicRoster, publicRosterName, sanitizeRosterRows } from "@/lib/website/roster";
import { embedPath, iframeSnippetFor, scriptSnippetFor, shortcodeFor } from "@/lib/website/embed-code";
import { isSafeNavUrl, rowToWebsiteSettings } from "@/lib/website/settings-shape";
import { embedThemeVars } from "@/lib/website/theme";
import { DEFAULT_BRANDING } from "@/lib/tenant/defaults";

const ALLOWED = ["https://www.club-a.example", "https://club-a.example"];

describe("origins / CORS", () => {
  it("normalises exact https origins and rejects everything else", () => {
    expect(normalizeOrigin("https://WWW.Club-A.example/")).toBe("https://www.club-a.example");
    expect(normalizeOrigin("https://www.club-a.example:8443")).toBe("https://www.club-a.example:8443");
    expect(normalizeOrigin("http://www.club-a.example")).toBeNull();
    expect(normalizeOrigin("https://www.club-a.example/path")).toBeNull();
    expect(normalizeOrigin("https://*.club-a.example")).toBeNull();
    expect(normalizeOrigin("https://user:pw@club-a.example")).toBeNull();
    expect(normalizeOrigin("https://localhost")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("https://a.example?x=1")).toBeNull();
  });

  it("parses an admin list, dedupes and reports invalid entries", () => {
    const r = parseOriginList("https://www.club-a.example\nhttps://www.club-a.example/ , http://bad.example\nnot a url");
    expect(r.origins).toEqual(["https://www.club-a.example"]);
    expect(r.invalid).toEqual(["http://bad.example", "not", "a", "url"]);
  });

  it("echoes only an allowed Origin, never *", () => {
    const ok = corsHeaders("https://www.club-a.example", ALLOWED);
    expect(ok["Access-Control-Allow-Origin"]).toBe("https://www.club-a.example");
    expect(ok.Vary).toBe("Origin");
    const evil = corsHeaders("https://www.club-b.example", ALLOWED);
    expect(evil["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders("https://www.club-a.example.evil.example", ALLOWED)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders(null, ALLOWED)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders("null", ALLOWED)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(isAllowedOrigin("https://WWW.CLUB-A.EXAMPLE", ALLOWED)).toBe(true);
  });

  it("builds frame-ancestors from valid origins only (no directive injection)", () => {
    expect(frameAncestorsCsp(ALLOWED)).toBe("frame-ancestors 'self' https://www.club-a.example https://club-a.example");
    expect(frameAncestorsCsp([])).toBe("frame-ancestors 'self'");
    expect(frameAncestorsCsp(["https://ok.example; script-src *", "*", "https://ok.example"])).toBe("frame-ancestors 'self' https://ok.example");
  });

  it("validates the postMessage parent origin and return_to links", () => {
    expect(embedParentOrigin("https://www.club-a.example", ALLOWED)).toBe("https://www.club-a.example");
    expect(embedParentOrigin("https://evil.example", ALLOWED)).toBeNull();
    expect(safeReturnTo("https://club-a.example/camps/?x=1", ALLOWED)).toBe("https://club-a.example/camps/?x=1");
    expect(safeReturnTo("https://evil.example/", ALLOWED)).toBeNull();
    expect(safeReturnTo("//evil.example", ALLOWED)).toBeNull();
    expect(safeReturnTo("javascript:alert(1)", ALLOWED)).toBeNull();
    expect(safeReturnTo("http://club-a.example/", ALLOWED)).toBeNull();
  });
});

describe("webhook signing", () => {
  it("signs the raw body with HMAC-SHA256 (known vector) and verifies in constant time", () => {
    // HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    expect(signBody("key", "The quick brown fox jumps over the lazy dog")).toBe("sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
    const body = contentUpdatedBody("camps", "club-a", new Date("2026-01-02T03:04:05.000Z"));
    expect(JSON.parse(body)).toEqual({ type: "content.updated", resource: "camps", club: "club-a", at: "2026-01-02T03:04:05.000Z" });
    const sig = signBody("s3cret", body);
    expect(verifySignature("s3cret", body, sig)).toBe(true);
    expect(verifySignature("other", body, sig)).toBe(false);
    expect(verifySignature("s3cret", `${body} `, sig)).toBe(false);
    expect(verifySignature("s3cret", body, "sha256=00")).toBe(false);
    expect(verifySignature("s3cret", body, null)).toBe(false);
  });

  it("generates long random secrets and seals them at rest", () => {
    const a = generateSecret();
    expect(a).toMatch(/^dlws_[0-9a-f]{64}$/);
    expect(generateSecret()).not.toBe(a);
    const key = "a-long-enough-server-key-material";
    const sealed = sealSecret(a, key);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain(a);
    expect(openSecret(sealed, key)).toBe(a);
    expect(openSecret(sealed, "another-long-server-key-material")).toBeNull();
    expect(openSecret(sealSecret(a, null), null)).toBe(a);
  });

  it("retries with backoff and stops after the last attempt", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(nextAttemptAt(1, now)!.getTime() - now.getTime()).toBe(60_000);
    expect(nextAttemptAt(2, now)!.getTime() - now.getTime()).toBe(5 * 60_000);
    expect(nextAttemptAt(MAX_ATTEMPTS, now)).toBeNull();
    expect(isPermanentFailure(404)).toBe(true);
    expect(isPermanentFailure(429)).toBe(false);
    expect(isPermanentFailure(503)).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows the limit per window per key, then refuses until the window resets", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
    const t0 = 1_000_000;
    expect([1, 2, 3].map(() => rl.check("1.2.3.4", t0).ok)).toEqual([true, true, true]);
    expect(rl.check("1.2.3.4", t0 + 10).ok).toBe(false);
    expect(rl.check("5.6.7.8", t0 + 10).ok).toBe(true);
    expect(rl.check("1.2.3.4", t0 + 1000).ok).toBe(true);
  });

  it("stays bounded under many distinct keys", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) rl.check(`ip-${i}`, 5);
    expect(rl.size()).toBeLessThanOrEqual(100);
  });

  it("reads the first X-Forwarded-For hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("public roster (minors)", () => {
  const members = [
    { firstName: "Synthia", lastName: "Example", jerseyNumber: 7, mediaConsent: true, active: true },
    { firstName: "Noconsent", lastName: "Child", jerseyNumber: 9, mediaConsent: false, active: true },
    { firstName: "Left", lastName: "Team", jerseyNumber: 4, mediaConsent: true, active: false },
    { firstName: "Alex", lastName: "", jerseyNumber: null, mediaConsent: true, active: true },
  ];
  it("lists only consented, active children as first name + initial", () => {
    const r = publicRoster(members, { clubRosterPublic: true, teamPublic: true, teamRosterPublic: true });
    expect(r).toEqual([{ name: "Synthia E.", number: 7 }, { name: "Alex", number: null }]);
    expect(JSON.stringify(r)).not.toContain("Example");
    expect(JSON.stringify(r)).not.toContain("Noconsent");
  });
  it("shows nothing unless the club, team and roster switches are all on", () => {
    expect(publicRoster(members, { clubRosterPublic: false, teamPublic: true, teamRosterPublic: true })).toEqual([]);
    expect(publicRoster(members, { clubRosterPublic: true, teamPublic: false, teamRosterPublic: true })).toEqual([]);
    expect(publicRoster(members, { clubRosterPublic: true, teamPublic: true, teamRosterPublic: false })).toEqual([]);
  });
  it("never lets a full last name through from the database rows", () => {
    expect(publicRosterName(" Mia ", "müller")).toBe("Mia M.");
    expect(sanitizeRosterRows([{ display_name: "Mia Müller", jersey_number: 3 }])).toEqual([{ name: "Mia M.", number: 3 }]);
  });
});

describe("embed code and settings", () => {
  it("generates shortcode, script and iframe snippets with escaped, allow-listed params", () => {
    const spec = { widget: "camps" as const, club: "club-a", theme: "dark" as const, params: { season: "summer", team: "x", year: '2026"><script>' } };
    expect(shortcodeFor(spec)).toBe('[dlang_camps season="summer" theme="dark"]');
    expect(shortcodeFor({ widget: "book", club: "dlang" })).toBe('[dlang_embed widget="book"]');
    expect(shortcodeFor({ widget: "register", club: "dlang", params: { program: "u14" } })).toBe('[dlang_embed widget="register" program="u14"]');
    expect(shortcodeFor({ widget: "teams", club: "dlang" })).toBe("[dlang_teams]");
    expect(scriptSnippetFor(spec, "https://app.example/")).toBe('<div data-dlang-widget="camps" data-club="club-a" data-season="summer" data-theme="dark"></div>\n<script src="https://app.example/embed.js" async></script>');
    expect(embedPath(spec, "https://www.club-a.example")).toBe("/embed/camps?club=club-a&theme=dark&season=summer&origin=https%3A%2F%2Fwww.club-a.example");
    expect(iframeSnippetFor(spec, "https://app.example")).not.toContain("<script>");
    expect(embedPath({ widget: "register", club: "club-a", params: { program: "summer-camp" } })).toBe("/embed/register/summer-camp?club=club-a");
  });

  it("defaults to nothing public about children and validates nav links", () => {
    const s = rowToWebsiteSettings("org", { enabled: true, allowed_origins: ["https://ok.example", "http://bad.example"], nav_links: [{ label: "Home", url: "https://ok.example/" }, { label: "X", url: "javascript:alert(1)" }, { label: "Shop", url: "/shop" }] });
    expect(s.rosterPublic).toBe(false);
    expect(s.sections.coaches).toBe(false);
    expect(s.allowedOrigins).toEqual(["https://ok.example"]);
    expect(s.navLinks.map((l) => l.label)).toEqual(["Home", "Shop"]);
    expect(isSafeNavUrl("//evil.example")).toBe(false);
  });

  it("themes embeds from validated colours (light keeps the brand primary)", () => {
    const light = embedThemeVars(DEFAULT_BRANDING, "light");
    expect(light["--bg"]).toBe("#FFFFFF");
    expect(light["--brand-primary"]).toBe(embedThemeVars(DEFAULT_BRANDING, "club")["--brand-primary"]);
    expect(embedThemeVars(DEFAULT_BRANDING, "dark")["--bg"]).toBe("#0A0A0A");
  });
});

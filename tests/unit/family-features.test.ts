import { describe, expect, it } from "vitest";
import { createDecipheriv, createECDH, hkdfSync, verify } from "node:crypto";
import { evenShares, exponentFor, splitAmount, splitLines, validateShares } from "@/lib/family/split";
import { buildPushPayload, pushAllowedFor, safePath, PUSH_BODY_MAX, PUSH_TITLE_MAX } from "@/lib/push/payload";
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, publicKeyObject, vapidAuthorization, vapidFromEnv, vapidJwt } from "@/lib/push/webpush";
import { areaSimilarity, areaTokens, seatsLeft, suggestMatches } from "@/lib/family/carpool";
import { generateScoutToken, hashScoutToken, isScoutTokenShape } from "@/lib/family/scout";
import { buildExportHtml, escapeHtml } from "@/lib/family/privacy-export";
import { evaluationTrend, pipelineProgress } from "@/lib/family/journey";
import { pickBillingRecipients } from "@/lib/family/billing";
import { billingSplitSchema, consentSchema, inviteGuardianSchema, placementSchema, pushSubscriptionSchema, scoutPublishSchema, SCOUT_FIELDS } from "@/lib/family/validation";
import { dbCode } from "@/lib/family/action-helpers";

// ---------------------------------------------------------------------------
describe("split billing math", () => {
  it("parts always add up exactly to the original", () => {
    expect(splitAmount(400.01, [60, 40])).toEqual([240.01, 160]);
    expect(splitAmount(99.99, [50, 50])).toEqual([50, 49.99]);
    expect(splitAmount(100, [33.34, 33.33, 33.33])).toEqual([33.34, 33.33, 33.33]);
    for (const amount of [0.01, 1, 10.05, 333.33, 1490, 12345.67]) {
      for (const pcts of [[50, 50], [60, 40], [70, 30], [33.33, 33.33, 33.34], [12.5, 87.5]]) {
        const parts = splitAmount(amount, pcts);
        const sum = parts.reduce((s, p) => s + Math.round(p * 100), 0);
        expect(sum).toBe(Math.round(amount * 100));
      }
    }
  });
  it("respects the currency's minor unit", () => {
    expect(exponentFor("JPY")).toBe(0);
    expect(exponentFor("CHF")).toBe(2);
    expect(splitAmount(1001, [50, 50], 0)).toEqual([501, 500]);
  });
  it("splits every line and keeps line totals", () => {
    const parts = splitLines([{ description: "Fee", quantity: 1, amount: 333.33 }, { description: "Kit", quantity: 1, amount: 66.68 }], [60, 40]);
    expect(parts[0]!.map((l) => l.amount)).toEqual([200, 40.01]);
    expect(parts[1]!.map((l) => l.amount)).toEqual([133.33, 26.67]);
    expect(parts[0]!.reduce((s, l) => s + l.amount, 0) + parts[1]!.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(400.01, 10);
  });
  it("validates shares like the database", () => {
    const a = "00000000-0000-0000-0000-00000000000a";
    const b = "00000000-0000-0000-0000-00000000000b";
    expect(validateShares([{ profileId: a, pct: 60 }, { profileId: b, pct: 40 }])).toBeNull();
    expect(validateShares([{ profileId: a, pct: 60 }, { profileId: b, pct: 30 }])).toBe("TOTAL");
    expect(validateShares([{ profileId: a, pct: 100 }, { profileId: b, pct: 0 }])).toBe("TWO_PAYERS");
    expect(validateShares([{ profileId: a, pct: 120 }, { profileId: b, pct: -20 }])).toBe("RANGE");
    expect(validateShares([{ profileId: a, pct: 50 }, { profileId: a, pct: 50 }])).toBe("DUPLICATE");
    expect(validateShares([{ profileId: a, pct: 33.34 }, { profileId: b, pct: 33.33 }, { profileId: "c", pct: 33.33 }])).toBeNull();
  });
  it("even shares total 100", () => {
    expect(evenShares(["a", "b"]).map((s) => s.pct)).toEqual([50, 50]);
    expect(evenShares(["a", "b", "c"]).map((s) => s.pct)).toEqual([33.34, 33.33, 33.33]);
    expect(evenShares([])).toEqual([]);
  });
  it("split schema refuses bad input", () => {
    expect(billingSplitSchema.safeParse({ familyId: "x", mode: "split", shares: [] }).success).toBe(false);
    expect(billingSplitSchema.safeParse({ familyId: "00000000-0000-0000-0000-000000000001", mode: "split", shares: [{ profileId: "00000000-0000-0000-0000-000000000002", pct: 50.001 }] }).success).toBe(false);
  });
});

describe("billing recipients with a second guardian", () => {
  const people = [{ profileId: "p1", email: "a" }, { profileId: "p2", email: "b" }];
  it("a split part goes to its payer only", () => {
    expect(pickBillingRecipients(people, { payerId: "p2", receivesEmails: new Set(["p1", "p2"]) }).map((p) => p.profileId)).toEqual(["p2"]);
  });
  it("otherwise guardians who receive emails", () => {
    expect(pickBillingRecipients(people, { payerId: null, receivesEmails: new Set(["p1"]) }).map((p) => p.profileId)).toEqual(["p1"]);
  });
  it("never leaves a family without a billing contact", () => {
    expect(pickBillingRecipients(people, { payerId: null, receivesEmails: new Set() })).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe("push payload and preference filtering", () => {
  it("builds a small, same-origin payload", () => {
    const p = JSON.parse(buildPushPayload({ title: "x".repeat(500), body: "y".repeat(1000), path: "https://evil.example/phish", tag: "event-1 <x>" }));
    expect(p.title.length).toBe(PUSH_TITLE_MAX);
    expect(p.body.length).toBe(PUSH_BODY_MAX);
    expect(p.url).toBe("/");
    expect(p.tag).toBe("event-1x");
    expect(JSON.parse(buildPushPayload({ title: "A", path: "/parent/schedule", urgent: true })).urgent).toBe(true);
  });
  it("only accepts same-origin absolute paths", () => {
    expect(safePath("/parent/messages/123")).toBe("/parent/messages/123");
    expect(safePath("//evil.example")).toBe("/");
    expect(safePath("javascript:alert(1)")).toBe("/");
  });
  const now = new Date("2026-03-02T22:30:00Z"); // 23:30 Zurich
  const tz = "Europe/Zurich";
  it("respects the per-category push switch", () => {
    const ids = pushAllowedFor({ profileIds: ["a", "b"], category: "events", prefs: [{ profile_id: "b", channels: { events: { in_app: true, email: true, push: false } }, quiet_start: null, quiet_end: null }], timeZone: tz, now });
    expect(ids).toEqual(["a"]);
  });
  it("defaults: on for events/messages/payments, off for announcements", () => {
    expect(pushAllowedFor({ profileIds: ["a"], category: "payments", prefs: [], timeZone: tz, now })).toEqual(["a"]);
    expect(pushAllowedFor({ profileIds: ["a"], category: "announcements", prefs: [], timeZone: tz, now })).toEqual([]);
  });
  it("quiet hours suppress push, except urgent", () => {
    const prefs = [{ profile_id: "a", channels: {}, quiet_start: "22:00", quiet_end: "07:00" }];
    expect(pushAllowedFor({ profileIds: ["a"], category: "events", prefs, timeZone: tz, now })).toEqual([]);
    expect(pushAllowedFor({ profileIds: ["a"], category: "alerts", prefs, timeZone: tz, now, urgent: true })).toEqual(["a"]);
    expect(pushAllowedFor({ profileIds: ["a"], category: "events", prefs: [], orgQuiet: { start: "23:00", end: "06:00" }, timeZone: tz, now })).toEqual([]);
  });
  it("subscription schema requires https and base64url keys", () => {
    const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://push.example/x", keys }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "http://push.example/x", keys }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://push.example/x", keys: { ...keys, auth: "a+b/" } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("VAPID", () => {
  const keys = { ...generateVapidKeys(), subject: "mailto:ops@example.test" };
  it("reads keys from the environment and no-ops when unset", () => {
    expect(vapidFromEnv({})).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "nope" })).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: "abc", VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: keys.subject })).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: keys.subject })).toEqual(keys);
  });
  it("signs an ES256 JWT that verifies with the public key", () => {
    const jwt = vapidJwt("https://fcm.googleapis.com", keys, 1_700_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(b64urlDecode(h!).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(b64urlDecode(c!).toString())).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_700_000_000 + 43200, sub: keys.subject });
    const sig = b64urlDecode(s!);
    expect(sig.length).toBe(64);
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKeyObject(keys.publicKey), dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
    const other = generateVapidKeys();
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKeyObject(other.publicKey), dsaEncoding: "ieee-p1363" }, sig)).toBe(false);
  });
  it("uses the push service origin as audience", () => {
    const auth = vapidAuthorization("https://updates.push.services.mozilla.com/wpush/v2/abc", keys, 1_700_000_000);
    expect(auth.startsWith("vapid t=")).toBe(true);
    expect(auth.endsWith(`, k=${keys.publicKey}`)).toBe(true);
    const claims = JSON.parse(b64urlDecode(auth.slice(8).split(",")[0]!.split(".")[1]!).toString());
    expect(claims.aud).toBe("https://updates.push.services.mozilla.com");
  });
});

describe("Web Push encryption (RFC 8291)", () => {
  it("matches the RFC 8291 Appendix A test vector", () => {
    const body = encryptPayload(
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      "When I grow up, I want to be a watermelon",
      { ephemeralPrivateKey: b64urlDecode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw") },
    );
    expect(b64urlEncode(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });
  it("round-trips with the browser's private key", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = Buffer.from("0123456789abcdef");
    const body = encryptPayload({ p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) }, JSON.stringify({ title: "Hi" }));
    // Decrypt as the user agent would.
    const salt = body.subarray(0, 16);
    const idlen = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idlen);
    const ct = body.subarray(21 + idlen);
    const shared = ua.computeSecret(asPublic);
    const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const d = createDecipheriv("aes-128-gcm", cek, nonce);
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    expect(plain[plain.length - 1]).toBe(2);
    expect(JSON.parse(plain.subarray(0, plain.length - 1).toString())).toEqual({ title: "Hi" });
    expect(body.readUInt32BE(16)).toBe(4096);
  });
  it("refuses malformed subscription keys", () => {
    expect(() => encryptPayload({ p256dh: "abc", auth: "def" }, "x")).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("carpool matching", () => {
  it("compares areas by words, accents ignored", () => {
    expect(areaTokens("Lausanne-Gare (Nord)")).toEqual(["lausanne", "gare", "nord"]);
    expect(areaSimilarity("Lausanne Gare", "lausanne-gare")).toBe(1);
    expect(areaSimilarity("Genève", "Geneve centre")).toBe(0.5);
    expect(areaSimilarity("Morges", "Nyon")).toBe(0);
  });
  it("seats left never negative", () => {
    expect(seatsLeft({ seatsTotal: 3, seatsTaken: 5 })).toBe(0);
  });
  it("suggests the closest offer with enough seats and never self-matches", () => {
    const offers = [
      { id: "o1", fromArea: "Morges", seatsTotal: 4, seatsTaken: 0, returnTrip: false, status: "open" },
      { id: "o2", fromArea: "Lausanne Gare", seatsTotal: 2, seatsTaken: 0, returnTrip: false, status: "open" },
      { id: "o3", fromArea: "Lausanne Gare", seatsTotal: 1, seatsTaken: 0, returnTrip: false, status: "open" },
      { id: "o4", fromArea: "Lausanne", seatsTotal: 4, seatsTaken: 0, returnTrip: false, status: "open", mine: true },
    ];
    const requests = [
      { id: "r1", fromArea: "Lausanne gare", seatsNeeded: 2, returnTrip: false, status: "open" },
      { id: "r2", fromArea: "Lausanne", seatsNeeded: 1, returnTrip: false, status: "open", mine: true },
      { id: "r3", fromArea: "Bern", seatsNeeded: 5, returnTrip: false, status: "open" },
      { id: "r4", fromArea: "Morges", seatsNeeded: 1, returnTrip: false, status: "matched" },
    ];
    const s = suggestMatches(offers, requests);
    expect(s.find((x) => x.requestId === "r1")?.offerId).toBe("o2");
    expect(s.find((x) => x.requestId === "r2")?.offerId).not.toBe("o4");
    expect(s.find((x) => x.requestId === "r3")).toBeUndefined();
    expect(s.find((x) => x.requestId === "r4")).toBeUndefined();
  });
  it("prefers a return trip when one is asked for", () => {
    const s = suggestMatches(
      [
        { id: "a", fromArea: "Nyon", seatsTotal: 2, seatsTaken: 0, returnTrip: false, status: "open" },
        { id: "b", fromArea: "Nyon", seatsTotal: 2, seatsTaken: 0, returnTrip: true, status: "open" },
      ],
      [{ id: "r", fromArea: "Nyon", seatsNeeded: 1, returnTrip: true, status: "open" }],
    );
    expect(s[0]?.offerId).toBe("b");
  });
});

// ---------------------------------------------------------------------------
describe("scout links", () => {
  it("token has 32 random bytes and only its hash is stored", () => {
    const a = generateScoutToken();
    const b = generateScoutToken();
    expect(isScoutTokenShape(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashScoutToken(a.token)).toBe(a.hash);
    expect(isScoutTokenShape("../../etc")).toBe(false);
  });
  it("publishing needs consent, a field list without medical data and a bounded expiry", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    expect(scoutPublishSchema.safeParse({ athleteId: id, fields: ["teams"], days: 30, consent: true }).success).toBe(true);
    expect(scoutPublishSchema.safeParse({ athleteId: id, fields: ["teams"], days: 30, consent: false }).success).toBe(false);
    expect(scoutPublishSchema.safeParse({ athleteId: id, fields: ["medical"], days: 30, consent: true }).success).toBe(false);
    expect(scoutPublishSchema.safeParse({ athleteId: id, fields: ["teams"], days: 400, consent: true }).success).toBe(false);
    expect(scoutPublishSchema.safeParse({ athleteId: id, fields: [], days: 30, consent: true }).success).toBe(false);
    expect((SCOUT_FIELDS as readonly string[]).some((f) => /medic|allerg|phone|email|address/.test(f))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("privacy export summary", () => {
  it("escapes every value and hides internal columns", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
    const html = buildExportHtml({
      title: "Data", intro: "Intro", generatedLabel: "Generated", generatedAt: "2026-01-02T10:00:00Z", emptyLabel: "None", lang: "en",
      fmtDate: (s) => s.slice(0, 10),
      sections: [
        { key: "children", title: "Children", rows: [{ first_name: "<b>Synth</b>", org_id: "secret-org", dob: "2015-01-01" }] },
        { key: "medical", title: "Medical", rows: [] },
      ],
    });
    expect(html).toContain("&lt;b&gt;Synth&lt;/b&gt;");
    expect(html).not.toContain("<b>Synth</b>");
    expect(html).not.toContain("secret-org");
    expect(html).toContain("<h2>Medical</h2><p class=\"muted\">None</p>");
    expect(html).toContain('lang="en"');
  });
});

describe("journey helpers", () => {
  it("evaluation trend compares the latest score with the earlier average", () => {
    expect(evaluationTrend([])).toEqual({ latest: null, delta: null });
    expect(evaluationTrend([{ date: "2026-01-01", score: 60 }])).toEqual({ latest: 60, delta: null });
    expect(evaluationTrend([{ date: "2026-03-01", score: 80 }, { date: "2026-01-01", score: 60 }, { date: "2026-02-01", score: 70 }])).toEqual({ latest: 80, delta: 15 });
  });
  it("pipeline progress", () => {
    expect(pipelineProgress("interested")).toBe(0);
    expect(pipelineProgress("placed")).toBe(1);
    expect(pipelineProgress("declined")).toBeNull();
  });
});

describe("family action validation", () => {
  const id = "00000000-0000-0000-0000-000000000001";
  it("guardian invite", () => {
    expect(inviteGuardianSchema.safeParse({ familyId: id, email: " Second@Example.TEST ", relation: "father", permissions: { canPay: true, canSeeMedical: false, receivesEmails: true } }).data?.email).toBe("second@example.test");
    expect(inviteGuardianSchema.safeParse({ familyId: id, email: "nope", permissions: { canPay: true, canSeeMedical: true, receivesEmails: true } }).success).toBe(false);
  });
  it("consents: media needs a child, marketing does not", () => {
    expect(consentSchema.safeParse({ kind: "media", granted: true }).success).toBe(false);
    expect(consentSchema.safeParse({ kind: "media", athleteId: id, granted: true }).success).toBe(true);
    expect(consentSchema.safeParse({ kind: "marketing", granted: false }).success).toBe(true);
  });
  it("placement status pipeline values", () => {
    expect(placementSchema.safeParse({ athleteId: id, targetName: "Synthetic Academy", targetKind: "academy", status: "trial", deadline: "" }).success).toBe(true);
    expect(placementSchema.safeParse({ athleteId: id, targetName: "X", targetKind: "academy", status: "signed" }).success).toBe(false);
  });
  it("maps database errors to translated codes", () => {
    expect(dbCode("NO_MEMBERSHIP")).toBe("NO_MEMBERSHIP");
    expect(dbCode('new row violates row-level security policy for table "x"')).toBe("forbidden");
    expect(dbCode("ERROR: INVOICE_LINKED: payments")).toBe("INVOICE_LINKED");
    expect(dbCode("something else")).toBe("generic");
  });
});

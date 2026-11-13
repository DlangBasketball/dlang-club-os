import { describe, expect, it } from "vitest";
import { canMessage, canWriteToOffice, sideOf, threadAccess, type Party, type ThreadFacts } from "@/lib/messaging/permissions";
import { effectiveChannels, inQuietHours, parseChannels, preferencesSchema, resolveDelivery, toMinutes } from "@/lib/messaging/preferences";
import { clientIpFrom, hashClientIp, LEAD_LIMITS, leadRateDecision, looksLikeBot, MIN_FILL_MS } from "@/lib/messaging/rate-limit";
import { broadcastShareText, whatsappShareUrl } from "@/lib/messaging/whatsapp";
import { alertSchema, cleanFileName, contactFormSchema, messagingErrorKey, sniffAttachmentType } from "@/lib/messaging/validation";
import { escapeHtml, messagingEmailHtml } from "@/lib/messaging/email";
import { appFor, threadPath } from "@/lib/messaging/paths";

// Synthetic parties of one club (org A) and another club (org B).
const A = "org-a";
const admin: Party = { id: "admin", orgId: A, roles: ["admin"] };
const finance: Party = { id: "finance", orgId: A, roles: ["finance"] };
const coach: Party = { id: "coach", orgId: A, roles: ["coach"], servedFamilyIds: ["fam-1"] };
const coach2: Party = { id: "coach2", orgId: A, roles: ["coach"], servedFamilyIds: [] };
const parent1: Party = { id: "p1", orgId: A, roles: ["parent"], familyIds: ["fam-1"] };
const parent2: Party = { id: "p2", orgId: A, roles: ["parent"], familyIds: ["fam-2"] };
const outsider: Party = { id: "x", orgId: A, roles: [] };
const otherClubAdmin: Party = { id: "b-admin", orgId: "org-b", roles: ["admin"] };
const otherClubParent: Party = { id: "b-p", orgId: "org-b", roles: ["parent"], familyIds: ["fam-b"] };

describe("permission matrix: who may message whom", () => {
  const cases: [string, Party, Party, boolean][] = [
    ["admin -> parent", admin, parent1, true],
    ["admin -> coach", admin, coach, true],
    ["finance -> parent (office)", finance, parent2, true],
    ["coach -> admin", coach, admin, true],
    ["coach -> other coach", coach, coach2, true],
    ["coach -> guardian of an athlete they coach", coach, parent1, true],
    ["coach -> unrelated guardian", coach, parent2, false],
    ["parent -> office (admin)", parent1, admin, true],
    ["parent -> office (finance)", parent1, finance, true],
    ["parent -> their child's coach", parent1, coach, true],
    ["parent -> a coach who does not coach their child", parent2, coach, false],
    ["parent -> another parent (never)", parent1, parent2, false],
    ["anyone -> account without role or family", admin, outsider, false],
    ["cross-club admin -> our parent", otherClubAdmin, parent1, false],
    ["our parent -> other club's parent", parent1, otherClubParent, false],
    ["self", admin, admin, false],
  ];
  for (const [name, from, to, expected] of cases) {
    it(name, () => expect(canMessage(from, to)).toBe(expected));
  }
  it("inactive accounts are never reachable", () => {
    expect(canMessage(admin, { ...parent1, active: false })).toBe(false);
  });
  it("only family-side users write to the office, and only when the club allows it", () => {
    expect(canWriteToOffice(parent1, true)).toBe(true);
    expect(canWriteToOffice(parent1, false)).toBe(false);
    expect(canWriteToOffice(coach, true)).toBe(false);
  });
  it("sides", () => {
    expect(sideOf(["parent"])).toBe("family");
    expect(sideOf(["coach", "parent"])).toBe("staff");
  });
});

describe("thread access (mirror of msg_can_read / msg_can_post)", () => {
  const base: ThreadFacts = {
    sameOrg: true, kind: "direct", status: "open", office: false, allowReplies: true, parentRepliesEnabled: true,
    isParticipant: false, isScopeStaff: false, isScopeGuardian: false,
  };
  it("participants read and post in direct threads", () => {
    expect(threadAccess(["parent"], { ...base, isParticipant: true })).toEqual({ read: true, post: true, member: true, moderate: false });
  });
  it("a coach who is not in the thread cannot read it", () => {
    expect(threadAccess(["coach"], base).read).toBe(false);
  });
  it("admins read every thread (oversight) and moderate", () => {
    const a = threadAccess(["admin"], base);
    expect(a.read && a.moderate && !a.member).toBe(true);
  });
  it("finance reads office threads only", () => {
    expect(threadAccess(["finance"], { ...base, office: true }).read).toBe(true);
    expect(threadAccess(["finance"], base).read).toBe(false);
  });
  it("closed threads are read-only", () => {
    expect(threadAccess(["parent"], { ...base, isParticipant: true, status: "closed" }).post).toBe(false);
  });
  it("channels: guardians read; reply only when allowed by thread and club", () => {
    const ch: ThreadFacts = { ...base, kind: "channel", isScopeGuardian: true };
    expect(threadAccess(["parent"], ch)).toMatchObject({ read: true, post: true });
    expect(threadAccess(["parent"], { ...ch, allowReplies: false }).post).toBe(false);
    expect(threadAccess(["parent"], { ...ch, parentRepliesEnabled: false }).post).toBe(false);
    expect(threadAccess(["coach"], { ...ch, isScopeGuardian: false, isScopeStaff: true }).post).toBe(true);
    expect(threadAccess(["coach"], { ...ch, isScopeGuardian: false }).read).toBe(false);
  });
  it("other clubs see nothing", () => {
    expect(threadAccess(["admin"], { ...base, sameOrg: false })).toEqual({ read: false, post: false, member: false, moderate: false });
  });
});

describe("rate limiting for the public contact form", () => {
  it("allows under the limits", () => {
    expect(leadRateDecision({ ipLast10Min: 0, ipLastDay: 0, orgLastHour: 0 })).toEqual({ allowed: true });
    expect(leadRateDecision({ ipLast10Min: LEAD_LIMITS.perIp10Min - 1, ipLastDay: 5, orgLastHour: 50 }).allowed).toBe(true);
  });
  it("blocks a burst from one IP", () => {
    expect(leadRateDecision({ ipLast10Min: LEAD_LIMITS.perIp10Min, ipLastDay: 3, orgLastHour: 3 })).toEqual({ allowed: false, reason: "ip_burst" });
  });
  it("blocks the daily cap per IP", () => {
    expect(leadRateDecision({ ipLast10Min: 0, ipLastDay: LEAD_LIMITS.perIpDay, orgLastHour: 10 })).toEqual({ allowed: false, reason: "ip_daily" });
  });
  it("blocks a flood across IPs for one club", () => {
    expect(leadRateDecision({ ipLast10Min: 0, ipLastDay: 0, orgLastHour: LEAD_LIMITS.perOrgHour })).toEqual({ allowed: false, reason: "club_hourly" });
  });
  it("matches the database limits (public.contact_lead_limits)", () => {
    expect(LEAD_LIMITS).toEqual({ perIp10Min: 3, perIpDay: 10, perOrgHour: 100 });
  });
  it("hashes the IP per club with a secret and never returns the IP", () => {
    const h1 = hashClientIp("203.0.113.7", "org-a", "s3cret");
    const h2 = hashClientIp("203.0.113.7", "org-b", "s3cret");
    const h3 = hashClientIp("203.0.113.7", "org-a", "other");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toContain("203");
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(hashClientIp(null, "org-a", "s")).toBeNull();
  });
  it("reads the first forwarded address", () => {
    const h = new Map([["x-forwarded-for", "198.51.100.1, 10.0.0.1"]]);
    expect(clientIpFrom((n) => h.get(n) ?? null)).toBe("198.51.100.1");
    expect(clientIpFrom(() => null)).toBeNull();
  });
  it("honeypot and fill-time trap", () => {
    const now = 1_000_000;
    expect(looksLikeBot("http://spam", now - 10_000, now)).toBe(true);
    expect(looksLikeBot("", now - 100, now)).toBe(true);
    expect(looksLikeBot("", undefined, now)).toBe(true);
    expect(looksLikeBot("", now - MIN_FILL_MS - 1, now)).toBe(false);
  });
});

describe("notification preference resolution", () => {
  const now = new Date("2026-03-02T22:30:00Z"); // 23:30 in Zurich (CET)
  const tz = "Europe/Zurich";
  it("defaults: in-app and email on", () => {
    expect(resolveDelivery({ category: "alerts", now, timeZone: tz })).toEqual({ inApp: true, email: true, quietHours: false });
  });
  it("user switches apply", () => {
    expect(resolveDelivery({ category: "alerts", prefs: { alerts: { in_app: false, email: false } }, now, timeZone: tz })).toEqual({ inApp: false, email: false, quietHours: false });
  });
  it("in-app for messages cannot be turned off", () => {
    expect(resolveDelivery({ category: "messages", prefs: { messages: { in_app: false, email: true } }, now, timeZone: tz }).inApp).toBe(true);
  });
  it("club switch turns off message emails", () => {
    expect(resolveDelivery({ category: "messages", orgEmailEnabled: false, now, timeZone: tz }).email).toBe(false);
    expect(resolveDelivery({ category: "alerts", orgEmailEnabled: false, now, timeZone: tz }).email).toBe(true);
  });
  it("no email address, no email", () => {
    expect(resolveDelivery({ category: "alerts", hasEmail: false, now, timeZone: tz }).email).toBe(false);
  });
  it("user quiet hours (overnight) suppress email but keep in-app", () => {
    const d = resolveDelivery({ category: "messages", quiet: { start: "22:00", end: "07:00" }, now, timeZone: tz });
    expect(d).toEqual({ inApp: true, email: false, quietHours: true });
  });
  it("club quiet hours apply when the user has none", () => {
    expect(resolveDelivery({ category: "messages", orgQuiet: { start: "23:00", end: "06:00" }, now, timeZone: tz }).quietHours).toBe(true);
    expect(resolveDelivery({ category: "messages", quiet: { start: "08:00", end: "09:00" }, orgQuiet: { start: "23:00", end: "06:00" }, now, timeZone: tz }).quietHours).toBe(false);
  });
  it("urgent alerts ignore quiet hours", () => {
    expect(resolveDelivery({ category: "alerts", quiet: { start: "22:00", end: "07:00" }, urgent: true, now, timeZone: tz }).email).toBe(true);
  });
  it("quiet-hour windows", () => {
    const noon = new Date("2026-06-01T10:00:00Z"); // 12:00 in Zurich (CEST)
    expect(inQuietHours(noon, tz, "11:00", "13:00")).toBe(true);
    expect(inQuietHours(noon, tz, "13:00", "11:00")).toBe(false);
    expect(inQuietHours(noon, tz, "12:00", "12:00")).toBe(false);
    expect(inQuietHours(noon, tz, null, "12:00")).toBe(false);
    expect(toMinutes("07:30:00")).toBe(450);
    expect(toMinutes("25:00")).toBeNull();
  });
  it("parses stored jsonb defensively and fills defaults", () => {
    expect(parseChannels({ messages: { email: false, in_app: "x" }, bogus: { email: true } })).toEqual({ messages: { email: false } });
    expect(parseChannels(null)).toEqual({});
    const eff = effectiveChannels({ messages: { in_app: false, email: false } });
    expect(eff.messages).toEqual({ in_app: true, email: false });
    expect(eff.leads).toEqual({ in_app: true, email: true });
  });
  it("validates the preferences form", () => {
    const ok = { channels: { messages: { in_app: true, email: false } }, quietStart: "22:00", quietEnd: "07:00" };
    expect(preferencesSchema.safeParse(ok).success).toBe(true);
    expect(preferencesSchema.safeParse({ ...ok, quietEnd: null }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...ok, quietEnd: "22:00" }).success).toBe(false);
  });
});

describe("WhatsApp share links (no numbers)", () => {
  it("builds wa.me links without a phone number", () => {
    const url = whatsappShareUrl(broadcastShareText({ title: "Practice moved", body: "Now 18:00 & gym B", link: "https://club.example" }));
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("Practice moved\n\nNow 18:00 & gym B\n\nhttps://club.example");
    expect(url).not.toMatch(/wa\.me\/\d/);
  });
  it("caps the text length", () => {
    expect(decodeURIComponent(whatsappShareUrl("x".repeat(5000)).split("text=")[1]).length).toBe(1500);
  });
});

describe("validation helpers", () => {
  it("contact form: consent, email, honeypot field", () => {
    const base = { name: "Synthetic Person", email: "Person@Example.test", phone: "", message: "Hello there", interest: "camp", consent: true };
    const p = contactFormSchema.safeParse(base);
    expect(p.success && p.data.email).toBe("person@example.test");
    expect(p.success && p.data.phone).toBeNull();
    expect(contactFormSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(contactFormSchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
    expect(contactFormSchema.safeParse({ ...base, phone: "<script>" }).success).toBe(false);
  });
  it("alerts need a scope for scoped audiences and none otherwise", () => {
    const a = { title: "Synthetic", body: "", severity: "info", audience: "team", scopeId: null, startsAt: "", expiresAt: "" };
    expect(alertSchema.safeParse(a).success).toBe(false);
    expect(alertSchema.safeParse({ ...a, scopeId: "00000000-0000-0000-0000-000000000043" }).success).toBe(true);
    expect(alertSchema.safeParse({ ...a, audience: "all", scopeId: "00000000-0000-0000-0000-000000000043" }).success).toBe(false);
    expect(alertSchema.safeParse({ ...a, audience: "all", startsAt: "2026-05-01T10:00", expiresAt: "2026-05-01T09:00" }).success).toBe(false);
  });
  it("maps database errors to catalog keys", () => {
    expect(messagingErrorKey("PARENT_START_DISABLED")).toBe("messaging.errors.parentStartDisabled");
    expect(messagingErrorKey("new row violates row-level security policy")).toBe("messaging.errors.forbidden");
    expect(messagingErrorKey("RATE_LIMITED")).toBe("messaging.errors.rateLimited");
    expect(messagingErrorKey(null)).toBe("messaging.errors.generic");
  });
  it("sniffs attachment types from bytes, not names", () => {
    expect(sniffAttachmentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe("application/pdf");
    expect(sniffAttachmentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffAttachmentType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(cleanFileName("../../etc/passwd<>.pdf", "pdf")).toBe("....etcpasswd.pdf");
    expect(cleanFileName("<>", "png")).toBe("attachment.png");
  });
});

describe("emails and paths", () => {
  it("escapes all values and keeps only http(s) links", () => {
    const html = messagingEmailHtml({ brand: { clubName: "<Club>" }, heading: "<b>Hi</b>", lines: ["a & b"], quote: "<script>x</script>", cta: { label: "Go", href: "javascript:alert(1)" }, footer: "f" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(html).not.toContain("javascript:");
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
  it("routes each role to its own app", () => {
    expect(appFor(["finance"])).toBe("admin");
    expect(appFor(["coach"])).toBe("coach");
    expect(appFor(["parent"])).toBe("parent");
    expect(threadPath("parent", "abc")).toBe("/parent/messages/abc");
  });
});

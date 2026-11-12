import { describe, expect, it } from "vitest";
import { StandardFonts, PDFDocument } from "pdf-lib";
import { tenantBaseUrl, tenantLink } from "@/lib/tenant/url";
import { zonedWallTimeToUtc, formatTime } from "@/lib/format";
import { buildInvoicePdf, paymentFooterText, toWinAnsi } from "@/lib/invoice-pdf";
import { invoiceIssued, registrationConfirmation } from "@/lib/email/templates";
import { render } from "@/lib/notifications/templates";
import { isCustomTerm, normalizeTerminology, termOr } from "@/lib/tenant/terms";
import { labelsFor } from "@/lib/sportsops/labels";

const norm = (s: string) => s.replace(/[\u00A0\u202F]/g, " ").replace(/\u2019/g, "'");

describe("tenantBaseUrl", () => {
  const env = { rootDomain: "clubos.app", siteUrl: "https://clubos.app/" };
  it("prefers the club's custom domain", () => {
    expect(tenantBaseUrl({ slug: "riverside", customDomain: "members.riverside.org" }, env)).toBe("https://members.riverside.org");
  });
  it("uses <slug>.<root> otherwise — never the apex, which falls back to the default club", () => {
    expect(tenantBaseUrl({ slug: "riverside" }, env)).toBe("https://riverside.clubos.app");
  });
  it("falls back to the site URL only without a root domain (single-tenant dev)", () => {
    expect(tenantBaseUrl({ slug: "riverside" }, { rootDomain: null, siteUrl: "http://localhost:3000/" })).toBe("http://localhost:3000");
  });
  it("joins paths", () => {
    expect(tenantLink("https://a.clubos.app/", "/parent/invoices/1")).toBe("https://a.clubos.app/parent/invoices/1");
    expect(tenantLink("https://a.clubos.app", "https://x.test/y")).toBe("https://x.test/y");
  });
});

describe("zonedWallTimeToUtc", () => {
  it("reads typed times in the club's zone, not the browser's", () => {
    // New York club, 17:00 in November (EST, UTC-5) -> 22:00Z, and shows back as 17:00 there.
    const d = zonedWallTimeToUtc("2026-11-20", "17:00", "America/New_York")!;
    expect(d.toISOString()).toBe("2026-11-20T22:00:00.000Z");
    expect(formatTime(d, { locale: "en-GB", timeZone: "America/New_York" })).toBe("17:00");
    // Zurich in summer (CEST, UTC+2).
    expect(zonedWallTimeToUtc("2026-07-01", "17:00", "Europe/Zurich")!.toISOString()).toBe("2026-07-01T15:00:00.000Z");
  });
  it("handles a DST-change day and rejects junk", () => {
    expect(zonedWallTimeToUtc("2026-03-29", "12:00", "Europe/Zurich")!.toISOString()).toBe("2026-03-29T10:00:00.000Z");
    expect(zonedWallTimeToUtc("bad", "17:00", "UTC")).toBeNull();
  });
});

describe("invoice PDF with non-Latin-1 text", () => {
  it("folds characters the standard font cannot encode", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const cs = new Set(font.getCharacterSet());
    expect(toWinAnsi("Łódź Basket", cs)).toBe("Lódz Basket");
    expect(toWinAnsi("Čech Nguyễn Müller", cs)).toBe("Cech Nguyen Müller");
    expect(toWinAnsi("東京", cs)).toBe("??");
  });

  it("renders instead of throwing (was a 500 for PLN/CZK clubs)", async () => {
    const bytes = await buildInvoicePdf({
      number: "INV-1", issuedAt: "2026-11-01", dueDate: "2026-11-15", status: "sent",
      familyName: "Rodzina Łukaszewicz", contactName: "Václav Dvořák", contactEmail: "p@example.test",
      items: [{ description: "Obóz letni – tydzień 1", quantity: 1, unitPrice: 900, amount: 900 }],
      total: 900, paid: 0, balance: 900,
      club: { name: "Łódź Basket", city: "Łódź", country: "PL" }, currency: "PLN",
      brandColor: "#1E40AF", platformName: "Acme Sports", paymentNote: "Pay online (Card) via your parent account.",
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("payment footer follows the methods actually available", () => {
    expect(paymentFooterText([{ key: "card", label: "Card", via: "stripe" }, { key: "ach", label: "ACH bank debit", via: "stripe" }])).toBe("Pay online (Card, ACH bank debit) via your parent account.");
    expect(paymentFooterText([{ key: "bank_transfer", label: "Bank transfer", via: "offline" }])).not.toMatch(/TWINT/);
    expect(paymentFooterText([])).toBe("Please contact the club to arrange payment.");
  });
});

describe("tenant-branded emails", () => {
  it("use the club colour, logo and currency", () => {
    const r = invoiceIssued({
      clubName: "Riverside FC", primaryColor: "#1E40AF", logoUrl: "https://cdn.example.test/logo.png", currency: "USD", locale: "en-US",
      parentName: "Sam", invoiceNumber: "INV-9", description: null, totalChf: 1490, dueDateLabel: "Nov 30, 2026", payUrl: "https://riverside.clubos.app/parent/invoices/9",
    });
    expect(r.subject).toBe("Invoice INV-9 — $1,490.00");
    expect(r.html).toContain("background:#1E40AF");
    expect(r.html).not.toContain("#DA2627");
    expect(r.html).toContain('src="https://cdn.example.test/logo.png"');
    expect(r.html).not.toMatch(/TWINT|CHF/);
  });
  it("ignores unsafe colour / logo values", () => {
    const r = registrationConfirmation({ primaryColor: "red;background:url(x)", logoUrl: "javascript:alert(1)", parentName: "C", programName: "P", children: ["A"], invoiceNumber: "I", totalChf: 1, dueDateLabel: "d", manageUrl: "u" });
    expect(r.html).toContain("#DA2627");
    expect(r.html).not.toContain("javascript:");
  });
  it("notifications format money in the club currency and link to the club host", () => {
    const r = render("invoice_sent", { invoice_number: "I-1", amount_due: 50, payment_link: "/parent/invoices/1" }, { currency: "EUR", locale: "de-DE", primaryColor: "#0F766E", baseUrl: "https://riverside.clubos.app" });
    expect(norm(r.subject)).toBe("Invoice I-1 — 50,00 € due");
    expect(r.html).toContain('href="https://riverside.clubos.app/parent/invoices/1"');
    expect(r.html).toContain("#0F766E");
    // Context does not leak into the next render.
    expect(norm(render("invoice_sent", { amount_due: 50 }).subject)).toContain("CHF 50.00");
  });
});

describe("terminology", () => {
  const school = normalizeTerminology({ athlete: { one: "Student", other: "Students" }, program: "Class" });
  it("uses the tenant's word only where it was renamed", () => {
    expect(isCustomTerm(school, "athlete")).toBe(true);
    expect(termOr(school, "athlete", "Athlètes", { plural: true })).toBe("Students");
    expect(termOr(school, "program", "Programmes", { plural: true })).toBe("Classes");
    expect(termOr(school, "family", "Familles", { plural: true })).toBe("Familles");
  });
  it("feeds the sports-ops labels", () => {
    expect(labelsFor(school).athletes).toBe("Students");
    expect(labelsFor(undefined).athlete).toBe("Athlete");
  });
});

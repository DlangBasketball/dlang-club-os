import { describe, expect, it } from "vitest";
import {
  OPEN_INVOICE_STATUSES, isOpenInvoiceStatus, isOverdueInvoice, openByFamily, openInvoices, summarizeOpenInvoices, totalsList,
  type InvoiceRow,
} from "@/lib/payments/open-invoices";
import { mergeUpcoming, type UpcomingItem } from "@/lib/data/dashboard-merge";

const row = (o: Partial<InvoiceRow> & { id: string }): InvoiceRow => ({
  familyId: "f1", status: "sent", dueDate: "2026-12-31", currency: "CHF", total: 100, adjustmentsTotal: 0, ...o,
});
const TODAY = "2026-11-22";

describe("open invoice statuses (dashboard, family balances, outstanding export)", () => {
  it("issued invoices still owed are open; drafts and closed ones are not", () => {
    // Regression: the dashboard / family list used ["pending","draft","overdue"],
    // so a normal issued ('sent') or partly paid invoice never counted as open
    // and drafts did.
    for (const s of ["sent", "partially_paid", "overdue", "pending"]) expect(isOpenInvoiceStatus(s)).toBe(true);
    for (const s of ["draft", "paid", "cancelled", "void", "written_off", "refunded"]) expect(isOpenInvoiceStatus(s)).toBe(false);
    expect([...OPEN_INVOICE_STATUSES].sort()).toEqual(["overdue", "partially_paid", "pending", "sent"]);
  });

  it("overdue = flagged overdue or open and past its due date", () => {
    expect(isOverdueInvoice({ status: "sent", dueDate: "2026-11-21" }, TODAY)).toBe(true);
    expect(isOverdueInvoice({ status: "sent", dueDate: TODAY }, TODAY)).toBe(false);
    expect(isOverdueInvoice({ status: "overdue", dueDate: null }, TODAY)).toBe(true);
    expect(isOverdueInvoice({ status: "partially_paid", dueDate: null }, TODAY)).toBe(false);
  });
});

describe("openInvoices: balances, not issued totals", () => {
  it("subtracts net payments and adds credit / debit notes; never negative", () => {
    const pays = new Map([
      ["a", [{ amount: 30, status: "succeeded" }, { amount: 99, status: "failed" }]],
      ["c", [{ amount: 150, status: "succeeded" }]],
    ]);
    const out = openInvoices(
      [
        row({ id: "a", status: "partially_paid", total: 100 }),
        row({ id: "b", status: "sent", total: 80, adjustmentsTotal: -20 }),
        row({ id: "c", status: "sent", total: 100 }), // overpaid, status not yet updated
        row({ id: "d", status: "draft", total: 500 }),
        row({ id: "e", status: "paid", total: 500 }),
      ],
      pays,
    );
    expect(out.map((o) => [o.id, o.balance])).toEqual([["a", 70], ["b", 60], ["c", 0]]);
  });

  it("sums per currency and per family", () => {
    const out = openInvoices(
      [
        row({ id: "1", familyId: "f1", total: 10.1, dueDate: "2026-01-01" }),
        row({ id: "2", familyId: "f1", total: 20.2 }),
        row({ id: "3", familyId: "f2", total: 50, currency: "eur" }),
      ],
      new Map(),
    );
    const s = summarizeOpenInvoices(out, TODAY);
    expect(s.overdue).toEqual({ count: 1, totals: { CHF: 10.1 } });
    expect(s.open).toEqual({ count: 2, totals: { CHF: 20.2, EUR: 50 } });
    const fam = openByFamily(out);
    expect(fam.get("f1")).toEqual({ count: 2, totals: { CHF: 30.3 } });
    expect(fam.get("f2")).toEqual({ count: 1, totals: { EUR: 50 } });
    expect(totalsList({ EUR: 50, CHF: 20.2 }, "chf")).toEqual([{ currency: "CHF", amount: 20.2 }, { currency: "EUR", amount: 50 }]);
    expect(totalsList({}, "EUR")).toEqual([{ currency: "EUR", amount: 0 }]);
  });
});

describe("dashboard upcoming: sessions and team events together", () => {
  const item = (id: string, kind: "session" | "event", startsAt: string): UpcomingItem => ({
    id, kind, startsAt, location: null, title: id, eventType: kind === "event" ? "training" : null, coachName: null, coachId: null, href: `/x/${id}`,
  });
  it("merges both sources soonest first and keeps the limit", () => {
    // Regression: the card read programme sessions only, so a club scheduling
    // through teams saw "Nothing scheduled" while its calendar was full.
    const out = mergeUpcoming(
      [item("s1", "session", "2026-11-25T17:00:00Z")],
      [item("e1", "event", "2026-11-23T17:00:00Z"), item("e2", "event", "2026-11-24T17:00:00Z"), item("e3", "event", "2026-11-30T17:00:00Z")],
      3,
    );
    expect(out.map((o) => o.id)).toEqual(["e1", "e2", "s1"]);
    expect(mergeUpcoming([], [], 5)).toEqual([]);
  });
});

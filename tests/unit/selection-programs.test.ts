import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ageOn, countAllowed, decisionSchema, divisionSchema, formatCounts, monthlyFrom, normaliseCounts, packageChangeAllowed,
  packageDueDates, packageSchedule, packageSchema, parseCounts, reviewerChoices, selectionTransitionOk, suggestDivision,
  applicationExtrasSchema, type DivisionRule,
} from "@/lib/selection/rules";
import { parseReportFilters, reportQuery } from "@/lib/selection/report";
import { fakeSupabase, type FakeDb } from "./fixtures/fake-supabase";

/** Selection programmes: pure rules (SQL mirrors) and the accept -> invoice -> plan action flow. Synthetic data only. */

describe("package and plan options", () => {
  it("parses instalment counts and always allows pay in full", () => {
    expect(parseCounts("1-5")).toEqual([1, 2, 3, 4, 5]);
    expect(parseCounts("2-4, 10")).toEqual([1, 2, 3, 4, 10]);
    expect(parseCounts("1,2;3 6")).toEqual([1, 2, 3, 6]);
    expect(parseCounts("1-25")).toBeNull();
    expect(parseCounts("0")).toBeNull();
    expect(parseCounts("5-2")).toBeNull();
    expect(parseCounts("abc")).toBeNull();
    expect(normaliseCounts([10, 3, 3, 30, 0])).toEqual([1, 3, 10]);
    expect(formatCounts([1, 2, 3, 4, 5, 7, 9, 10])).toBe("1-5, 7, 9-10");
  });

  it("validates a package (price, counts)", () => {
    const ok = packageSchema.safeParse({ name: "3 tournaments", price: "4500", counts: "1-10" });
    expect(ok.success && ok.data.counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(packageSchema.safeParse({ name: "Free", price: "0", counts: "1" }).success).toBe(false);
    expect(packageSchema.safeParse({ name: "Bad counts", price: "100", counts: "1-30" }).success).toBe(false);
    expect(packageSchema.safeParse({ name: "", price: "100", counts: "1" }).success).toBe(false);
  });

  it("checks a chosen count against the package (families may choose fewer instalments)", () => {
    const pkg1 = { allowedCounts: [1, 2, 3, 4, 5] };
    expect([1, 2, 3, 4, 5].every((n) => countAllowed(pkg1, n))).toBe(true);
    expect(countAllowed(pkg1, 6)).toBe(false);
    expect(countAllowed({ allowedCounts: [5] }, 1)).toBe(true);
  });

  it("shows the monthly amount at the largest count (300 x 5, 300 x 10, 450 x 10)", () => {
    expect(monthlyFrom(1500, [1, 2, 3, 4, 5], "CHF")).toEqual({ amount: 300, count: 5 });
    expect(monthlyFrom(3000, parseCounts("1-10")!, "CHF")).toEqual({ amount: 300, count: 10 });
    expect(monthlyFrom(4500, parseCounts("1-10")!, "CHF")).toEqual({ amount: 450, count: 10 });
    expect(monthlyFrom(1000, [1, 3], "CHF")).toEqual({ amount: 333.34, count: 3 });
  });
});

describe("instalment schedule math", () => {
  it("splits evenly when possible: 4500 / 4 and 4500 / 3", () => {
    expect(packageSchedule(4500, 4, "CHF", "2026-11-21").map((l) => l.amount)).toEqual([1125, 1125, 1125, 1125]);
    expect(packageSchedule(4500, 3, "CHF", "2026-11-21").map((l) => l.amount)).toEqual([1500, 1500, 1500]);
  });

  it("puts the rounding remainder on the last instalment", () => {
    expect(packageSchedule(1000, 3, "CHF", "2026-01-10").map((l) => l.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(packageSchedule(3000, 7, "CHF", "2026-01-10").map((l) => l.amount)).toEqual([428.57, 428.57, 428.57, 428.57, 428.57, 428.57, 428.58]);
    const lines = packageSchedule(2999.99, 10, "EUR", "2026-01-10");
    expect(Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100)).toBe(299999);
  });

  it("is monthly from the start day with month-end clamping", () => {
    expect(packageDueDates("2026-11-21", 3)).toEqual(["2026-11-21", "2026-12-21", "2027-01-21"]);
    expect(packageDueDates("2027-01-31", 3)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(packageSchedule(1500, 1, "CHF", "2026-11-21")).toEqual([{ seq: 1, dueDate: "2026-11-21", amount: 1500 }]);
    expect(() => packageSchedule(1500, 25, "CHF", "2026-11-21")).toThrow();
  });
});

describe("divisions", () => {
  const divisions: DivisionRule[] = [
    { id: "u16", name: "U16", minBirthYear: 2011, maxBirthYear: 2012, ageUnder: null, ageCutoff: null, sort: 2, isActive: true },
    { id: "u14", name: "U14", minBirthYear: 2013, maxBirthYear: null, ageUnder: null, ageCutoff: null, sort: 1, isActive: true },
    { id: "u18", name: "U18", minBirthYear: null, maxBirthYear: null, ageUnder: 18, ageCutoff: "2026-12-31", sort: 3, isActive: true },
    { id: "old", name: "Old", minBirthYear: 1990, maxBirthYear: 2020, ageUnder: null, ageCutoff: null, sort: 0, isActive: false },
  ];
  it("suggests the division from the date of birth (sort order, active only)", () => {
    expect(suggestDivision(divisions, "2016-03-14", "2026-11-21")).toBe("u14");
    expect(suggestDivision(divisions, "2013-01-01", "2026-11-21")).toBe("u14");
    expect(suggestDivision(divisions, "2012-12-31", "2026-11-21")).toBe("u16");
    expect(suggestDivision(divisions, "2009-06-01", "2026-11-21")).toBe("u18");
    expect(suggestDivision(divisions, "2008-06-01", "2026-11-21")).toBeNull();
    expect(suggestDivision(divisions, null, "2026-11-21")).toBeNull();
    expect(suggestDivision(divisions, "not a date", "2026-11-21")).toBeNull();
  });
  it("computes the age on a day", () => {
    expect(ageOn("2012-11-22", "2026-11-21")).toBe(13);
    expect(ageOn("2012-11-21", "2026-11-21")).toBe(14);
  });
  it("validates a division form", () => {
    expect(divisionSchema.safeParse({ name: "U14", minBirthYear: "2013", maxBirthYear: "" }).success).toBe(true);
    expect(divisionSchema.safeParse({ name: "Bad", minBirthYear: "2014", maxBirthYear: "2012" }).success).toBe(false);
    expect(divisionSchema.safeParse({ name: "Bad", ageUnder: "120" }).success).toBe(false);
  });
});

describe("status transitions", () => {
  it("follows applied -> under review -> accepted / waitlisted / declined -> enrolled -> withdrawn", () => {
    expect(selectionTransitionOk("applied", "under_review")).toBe(true);
    expect(selectionTransitionOk("under_review", "accepted")).toBe(true);
    expect(selectionTransitionOk("waitlisted", "accepted")).toBe(true);
    expect(selectionTransitionOk("accepted", "enrolled")).toBe(true);
    expect(selectionTransitionOk("enrolled", "withdrawn")).toBe(true);
    expect(selectionTransitionOk("declined", "under_review")).toBe(true);
    expect(selectionTransitionOk("applied", "enrolled")).toBe(false);
    expect(selectionTransitionOk("withdrawn", "applied")).toBe(false);
    expect(selectionTransitionOk("enrolled", "declined")).toBe(false);
    expect(selectionTransitionOk("bogus", "accepted")).toBe(false);
    expect(reviewerChoices("applied")).toEqual(["under_review", "accepted", "waitlisted", "declined"]);
    expect(reviewerChoices("enrolled")).toEqual([]);
  });
  it("needs a message to decline; package change only before money or a plan", () => {
    expect(decisionSchema.safeParse({ status: "declined", note: "" }).success).toBe(false);
    expect(decisionSchema.safeParse({ status: "declined", note: "Not this season" }).success).toBe(true);
    expect(packageChangeAllowed({ status: "accepted", paid: 0, hasPlan: false })).toBe(true);
    expect(packageChangeAllowed({ status: "accepted", paid: 100, hasPlan: false })).toBe(false);
    expect(packageChangeAllowed({ status: "accepted", paid: 0, hasPlan: true })).toBe(false);
    expect(packageChangeAllowed({ status: "enrolled", paid: 0, hasPlan: false })).toBe(false);
  });
  it("accepts only https tryout links", () => {
    expect(applicationExtrasSchema.safeParse({ videoUrl: "https://video.example/x" }).success).toBe(true);
    expect(applicationExtrasSchema.safeParse({ videoUrl: "http://video.example/x" }).success).toBe(false);
    expect(applicationExtrasSchema.safeParse({ videoUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("report filters", () => {
  it("keeps valid ids only and drops division / package without a programme", () => {
    const p = "11111111-1111-4111-8111-111111111111";
    const d = "22222222-2222-4222-8222-222222222222";
    expect(parseReportFilters({ program: p, season: "2026", division: d, package: "x" })).toEqual({ programId: p, season: 2026, divisionId: d, packageId: null });
    expect(parseReportFilters({ division: d, season: "26" })).toEqual({ programId: null, season: null, divisionId: null, packageId: null });
    expect(reportQuery({ programId: p, season: 2026, divisionId: null, packageId: null })).toBe(`program=${p}&season=2026`);
  });
});

// ---------------------------------------------------------------------------
// Action flow: accept -> package invoice -> plan with 3 instalments
// ---------------------------------------------------------------------------
const ORG = "aaaaaaaa-0000-4000-8000-0000000000a1";
const APP = "cccccccc-0000-4000-8000-0000000000c1";
const PROG = "dddddddd-0000-4000-8000-0000000000d1";

const state: { db: FakeDb; user: { id: string; orgId: string; roles: string[] } | null; calls: { fn: string; args: unknown }[]; notices: string[] } = {
  db: fakeSupabase({}), user: null, calls: [], notices: [],
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.db.client }));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: async () => (state.user ? { ...state.user, email: null, fullName: null, onboardingCompleted: true } : null),
}));
vi.mock("@/lib/i18n/server", () => ({
  getTranslations: async () => Object.assign((k: string, v?: Record<string, unknown>) => (v?.count ? `${k}:${v.count}` : k), { dynamic: (k: string) => k, locale: "en" }),
}));
vi.mock("@/lib/upgrades/server", () => ({ requireFeature: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@/lib/selection/notify", () => ({
  notifySelection: async (_org: string, _id: string, kind: string) => { state.notices.push(kind); return 1; },
  notifyStaffNewApplication: async () => undefined,
}));
vi.mock("@/lib/camps/checkout-helpers", () => ({ createGuestAccount: async () => undefined }));

function seedDb() {
  const tables: Record<string, Record<string, unknown>[]> = {
    program_applications: [{ id: APP, org_id: ORG, program_id: PROG, status: "under_review", package_id: "pkg3", invoice_id: null, family_id: "fam" }],
    program_packages: [{ id: "pkg3", org_id: ORG, program_id: PROG, price: 4500, allowed_counts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
    invoices: [],
    payment_plan_installments: [],
  };
  // The RPCs mirror the SQL (tested for real in tests/db/selection_programs.sql).
  const rpc = {
    selection_set_status: (args: unknown) => {
      state.calls.push({ fn: "selection_set_status", args });
      const a = args as { p_application: string; p_status: string };
      const app = tables.program_applications.find((x) => x.id === a.p_application)!;
      const prev = app.status;
      app.status = a.p_status;
      if (a.p_status === "accepted") {
        const pkg = tables.program_packages.find((p) => p.id === app.package_id)!;
        tables.invoices.push({ id: "inv-1", org_id: ORG, program_id: PROG, total_chf: pkg.price, status: "sent", currency: "CHF" });
        app.invoice_id = "inv-1";
      }
      return { application_id: app.id, status: app.status, previous_status: prev, invoice_id: app.invoice_id };
    },
    selection_choose_plan: (args: unknown) => {
      state.calls.push({ fn: "selection_choose_plan", args });
      const a = args as { p_application: string; p_count: number };
      const app = tables.program_applications.find((x) => x.id === a.p_application)!;
      const pkg = tables.program_packages.find((p) => p.id === app.package_id)! as { allowed_counts: number[] };
      if (!countAllowed({ allowedCounts: pkg.allowed_counts }, a.p_count)) throw new Error("COUNT_NOT_ALLOWED");
      const inv = tables.invoices.find((i) => i.id === app.invoice_id)!;
      for (const l of packageSchedule(Number(inv.total_chf), a.p_count, "CHF", "2026-11-21")) {
        tables.payment_plan_installments.push({ invoice_id: inv.id, seq: l.seq, due_date: l.dueDate, amount: l.amount });
      }
      app.status = "enrolled";
      app.installment_count = a.p_count;
      return { invoice_id: inv.id, count: a.p_count };
    },
  };
  state.db = fakeSupabase(tables, rpc);
}

describe("accept -> invoice -> plan with 3 instalments (server actions)", () => {
  beforeEach(() => {
    seedDb();
    state.calls = [];
    state.notices = [];
  });

  it("a coach accepts: the package invoice exists and the family is notified", async () => {
    const { decideApplication } = await import("@/lib/actions/selection");
    state.user = { id: "coach-1", orgId: ORG, roles: ["coach"] };
    const res = await decideApplication(APP, { status: "accepted", note: "Welcome" });
    expect(res.ok).toBe(true);
    expect(state.calls[0]).toEqual({ fn: "selection_set_status", args: { p_application: APP, p_status: "accepted", p_note: "Welcome", p_division: null, p_staff_notes: null } });
    expect(state.db.tables.invoices).toHaveLength(1);
    expect(state.db.tables.invoices[0]).toMatchObject({ total_chf: 4500, program_id: PROG, status: "sent" });
    expect(state.notices).toEqual(["accepted"]);
  });

  it("the guardian sets up 3 monthly instalments of 1500 within the package rules", async () => {
    const { decideApplication, choosePackagePlan } = await import("@/lib/actions/selection");
    state.user = { id: "admin-1", orgId: ORG, roles: ["admin"] };
    await decideApplication(APP, { status: "accepted", note: "" });
    state.user = { id: "parent-1", orgId: ORG, roles: ["parent"] };
    const res = await choosePackagePlan(APP, 3);
    expect(res.ok).toBe(true);
    expect(state.calls.at(-1)).toEqual({ fn: "selection_choose_plan", args: { p_application: APP, p_count: 3 } });
    expect(state.db.tables.payment_plan_installments.map((i) => i.amount)).toEqual([1500, 1500, 1500]);
    expect(state.db.tables.payment_plan_installments.map((i) => i.due_date)).toEqual(["2026-11-21", "2026-12-21", "2027-01-21"]);
    expect(state.notices).toEqual(["accepted", "enrolled"]);
  });

  it("refuses without a session and validates input before calling the database", async () => {
    const { decideApplication, choosePackagePlan } = await import("@/lib/actions/selection");
    state.user = null;
    expect((await decideApplication(APP, { status: "accepted" })).ok).toBe(false);
    state.user = { id: "parent-1", orgId: ORG, roles: ["parent"] };
    expect((await choosePackagePlan("not-a-uuid", 3)).ok).toBe(false);
    expect((await choosePackagePlan(APP, 30)).ok).toBe(false);
    state.user = { id: "coach-1", orgId: ORG, roles: ["coach"] };
    expect((await decideApplication(APP, { status: "declined", note: "" })).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- revalidation helper: mock Next's cache and the website webhook ---------
const revalidatePath = vi.fn();
const revalidateTag = vi.fn();
const notifyWebsite = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a), revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));
vi.mock("@/lib/website/webhooks", () => ({ notifyWebsite: (...a: unknown[]) => notifyWebsite(...a) }));

import {
  confirmationMatches,
  daysUntilPurge,
  errorKeyFor,
  formatAmounts,
  groupPlannedTables,
  HIDDEN_ATHLETE_STATUS_FILTER,
  impactLines,
  isHiddenAthleteStatus,
  parseFiles,
  parseImpact,
  type DeleteImpact,
} from "@/lib/people/person-delete";
import { PERSON_ROUTE_GROUPS, PERSON_WEBSITE_RESOURCES, revalidatePersonEverywhere } from "@/lib/people/revalidate";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import fr from "@/messages/fr.json";
import itCat from "@/messages/it.json";
import es from "@/messages/es.json";

const ID = "d0000000-0000-0000-0000-0000000000b1";

function impact(over: Partial<Record<string, unknown>> = {}): DeleteImpact {
  return parseImpact({ kind: "athlete", id: ID, ...over })!;
}

describe("parseImpact", () => {
  it("maps the RPC's snake_case JSON and defaults missing counts to 0", () => {
    const i = parseImpact({
      kind: "family", id: ID, status: "active", teams: 2, camps: "1", invoices_cancelled: 1,
      invoices_cancelled_amounts: [{ currency: "CHF", amount: "300.00" }], invoices_kept: 3,
      tables: { athletes: 1, registrations: 2 }, blocked: [],
    });
    expect(i).not.toBeNull();
    expect(i!.kind).toBe("family");
    expect(i!.teams).toBe(2);
    expect(i!.camps).toBe(1);
    expect(i!.bookings).toBe(0);
    expect(i!.invoicesCancelledAmounts).toEqual([{ currency: "CHF", amount: 300 }]);
    expect(i!.invoicesKept).toBe(3);
    expect(i!.tables).toEqual({ athletes: 1, registrations: 2 });
  });

  it("rejects an unknown kind and survives garbage counts", () => {
    expect(parseImpact({ kind: "coach", id: ID })).toBeNull();
    expect(parseImpact(null)).toBeNull();
    const i = parseImpact({ kind: "athlete", id: ID, teams: -4, tables: "x", invoices_cancelled_amounts: "y" })!;
    expect(i.teams).toBe(0);
    expect(i.tables).toEqual({});
    expect(i.invoicesCancelledAmounts).toEqual([]);
  });
});

describe("impact summary formatting", () => {
  it("lists only non-empty sections, money last (cancelled before kept)", () => {
    const lines = impactLines(impact({ teams: 2, camps: 1, invoices_kept: 3, invoices_cancelled: 1, invoices_cancelled_amounts: [{ currency: "CHF", amount: 300 }] }));
    expect(lines.map((l) => l.key)).toEqual(["teams", "camps", "invoicesCancelled", "invoicesKept"]);
    expect(lines[2]).toMatchObject({ count: 1, amounts: [{ currency: "CHF", amount: 300 }] });
  });

  it("is empty when nothing is affected", () => {
    expect(impactLines(impact())).toEqual([]);
  });

  it("joins amounts per currency, sorted, skipping zero", () => {
    const money = (a: number, c: string) => `${c} ${a.toFixed(2)}`;
    expect(formatAmounts([{ currency: "EUR", amount: 20 }, { currency: "CHF", amount: 300 }, { currency: "USD", amount: 0 }], money)).toBe("CHF 300.00 + EUR 20.00");
  });

  it("every section has a message in all five catalogs", () => {
    const keys = ["teams", "programmes", "camps", "bookings", "waitlists", "memberships", "carpools", "rsvps", "kit", "paymentPlans", "autopay", "documents", "photos", "guardians", "invoicesCancelled", "invoicesKept", "nothing"];
    for (const cat of [en, de, fr, itCat, es]) {
      const impactMsgs = (cat as { personDelete: { impact: Record<string, string> } }).personDelete.impact;
      for (const k of keys) expect(impactMsgs[k], k).toBeTruthy();
    }
  });
});

describe("cascade plan grouping", () => {
  it("groups the planner's tables into recognisable areas, unknown tables into other", () => {
    const groups = groupPlannedTables({
      "public.athletes": 1, athlete_medical: 1, team_memberships: 2, registrations: 3, registration_answers: 1,
      attendance_marks: 7, documents: 2, evaluations: 1, some_future_table: 4, kit_assignments: 0,
    });
    expect(groups).toEqual([
      { group: "profile", count: 2 },
      { group: "teams", count: 2 },
      { group: "registrations", count: 4 },
      { group: "training", count: 7 },
      { group: "development", count: 1 },
      { group: "documents", count: 2 },
      { group: "other", count: 4 },
    ]);
  });

  it("returns nothing for an empty plan", () => {
    expect(groupPlannedTables({})).toEqual([]);
  });
});

describe("confirmation and status helpers", () => {
  it("typed confirmation ignores case and extra spaces but not other names", () => {
    expect(confirmationMatches("  xavanna   ZEPHYRINE ", "Xavanna Zephyrine")).toBe(true);
    expect(confirmationMatches("Xavanna", "Xavanna Zephyrine")).toBe(false);
    expect(confirmationMatches("", "")).toBe(false);
  });

  it("hides archived and erased athletes only", () => {
    expect(isHiddenAthleteStatus("archived")).toBe(true);
    expect(isHiddenAthleteStatus("erased")).toBe(true);
    expect(isHiddenAthleteStatus("inactive")).toBe(false);
    expect(isHiddenAthleteStatus(null)).toBe(false);
    expect(HIDDEN_ATHLETE_STATUS_FILTER).toBe("(archived,erased)");
  });

  it("maps database error codes to messages", () => {
    expect(errorKeyFor("NOT_AUTHORIZED")).toBe("personDelete.errors.forbidden");
    expect(errorKeyFor("PERSON_DELETE_BLOCKED: x")).toBe("personDelete.errors.blocked");
    expect(errorKeyFor("boom")).toBe("personDelete.errors.failed");
  });

  it("counts the days left before the purge", () => {
    const now = new Date("2026-11-21T10:00:00Z");
    expect(daysUntilPurge("2026-11-24T09:00:00Z", now)).toBe(3);
    expect(daysUntilPurge("2026-11-01T00:00:00Z", now)).toBe(0);
    expect(daysUntilPurge(null, now)).toBeNull();
  });

  it("keeps only safe file paths per bucket", () => {
    expect(parseFiles({ documents: ["a/b.pdf", "a/b.pdf", "../x", 4], "Bad Bucket": ["c"], "athlete-photos": [] })).toEqual([
      { bucket: "documents", paths: ["a/b.pdf"] },
    ]);
    expect(parseFiles(null)).toEqual([]);
  });
});

describe("revalidatePersonEverywhere", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    revalidateTag.mockReset();
    notifyWebsite.mockReset();
  });

  it("refreshes every portal, the site live blocks and the website API", () => {
    revalidatePersonEverywhere("org-1");
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([...PERSON_ROUTE_GROUPS]);
    expect(revalidatePath.mock.calls.every((c) => c[1] === "layout")).toBe(true);
    expect(PERSON_ROUTE_GROUPS).toEqual(expect.arrayContaining(["/admin", "/coach", "/parent"]));
    expect(revalidateTag).toHaveBeenCalledWith("site-live:org-1");
    expect(notifyWebsite).toHaveBeenCalledWith("org-1", ...PERSON_WEBSITE_RESOURCES);
    expect(PERSON_WEBSITE_RESOURCES).toEqual(expect.arrayContaining(["teams", "programs", "camps", "events"]));
  });

  it("without an org only refreshes the portals", () => {
    revalidatePersonEverywhere(null);
    expect(revalidatePath).toHaveBeenCalledTimes(PERSON_ROUTE_GROUPS.length);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(notifyWebsite).not.toHaveBeenCalled();
  });

  it("never throws outside a request (cron)", () => {
    revalidatePath.mockImplementation(() => { throw new Error("no request"); });
    revalidateTag.mockImplementation(() => { throw new Error("no request"); });
    notifyWebsite.mockImplementation(() => { throw new Error("no request"); });
    expect(() => revalidatePersonEverywhere("org-1")).not.toThrow();
  });
});

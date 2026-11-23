import { describe, expect, it } from "vitest";
import { coachesByRole, coverageOf, defaultLead, effectiveCoaches, parseCoverage, type CoverageInput } from "@/lib/attendance/coverage";
import { historyVerb, historyWording } from "@/lib/attendance/history-wording";
import en from "@/messages/en.json";

/*
 * TS mirror of the SQL coverage helpers (ac_session_coaches / ac_lead_pick /
 * ac_coverage, migration 20250420105000) — same scenarios as
 * tests/db/attendance_consistency.sql — and the history wording.
 * Synthetic names only.
 */

const head = { coachId: "c-head", name: "Synthetic Head", role: "head", createdAt: "2026-01-01T00:00:00Z" };
const helper = { coachId: "c-help", name: "Synthetic Helper", role: "assistant", createdAt: "2026-01-02T00:00:00Z" };
const lead = { coachId: "c-lead", name: "Synthetic Lead", role: "lead", status: "approved", decidedAt: "2026-11-01T10:00:00Z" };
const asst = { coachId: "c-asst", name: "Synthetic Assistant", role: "assistant", status: "approved", decidedAt: "2026-11-01T11:00:00Z" };
const sub = { coachId: "c-sub", name: "Synthetic Sub", role: "substitute", status: "approved", decidedAt: "2026-11-01T12:00:00Z" };
const none: CoverageInput = { assignments: [], teamCoaches: [] };

describe("coach coverage (mirror of ac_coverage)", () => {
  it("lead + assistant on one session: led by the session lead, both shown with their role", () => {
    const c = coverageOf({ assignments: [lead, asst], teamCoaches: [head] });
    expect(c.coverage).toBe("assigned");
    expect(c.ledByName).toBe("Synthetic Lead");
    expect(c.ledBySource).toBe("session");
    expect(c.coaches.map((x) => `${x.name}:${x.role}`)).toEqual([
      "Synthetic Head:lead", "Synthetic Lead:lead", "Synthetic Assistant:assistant",
    ]);
    expect(c.substitute).toBe(false);
  });

  it("an approved lead or assistant is never labelled substitute", () => {
    expect(coverageOf({ assignments: [lead], teamCoaches: [] }).coverage).toBe("assigned");
    expect(coverageOf({ assignments: [asst], teamCoaches: [] }).coverage).toBe("assigned");
  });

  it("substitute only: 'Substitute assigned' and no lead named", () => {
    const c = coverageOf({ assignments: [sub], teamCoaches: [] });
    expect(c.coverage).toBe("substitute");
    expect(c.ledByName).toBeNull();
  });

  it("nobody at all: 'No coach assigned'", () => {
    expect(coverageOf(none).coverage).toBe("missing");
  });

  it("booked session without team coaches: led by the session coach, not missing", () => {
    const c = coverageOf({ ...none, bookingCoach: { coachId: "c-pt", name: "Synthetic Private" } });
    expect(c.coverage).toBe("assigned");
    expect(c.ledByName).toBe("Synthetic Private");
    expect(c.ledBySource).toBe("booking");
  });

  it("led by: sheet > session lead > booked coach > team head", () => {
    const base: CoverageInput = { assignments: [lead], teamCoaches: [head], bookingCoach: { coachId: "c-pt", name: "Synthetic Private" } };
    expect(coverageOf({ ...base, sheetLead: { coachId: "c-x", name: "Synthetic Chosen" } }).ledBySource).toBe("sheet");
    expect(defaultLead(base)?.coachId).toBe("c-lead");
    expect(defaultLead({ ...base, assignments: [] })?.coachId).toBe("c-pt");
    expect(defaultLead({ assignments: [], teamCoaches: [helper, head] })?.coachId).toBe("c-head");
    expect(defaultLead({ assignments: [], teamCoaches: [helper] })).toBeNull();
  });

  it("a session assignment decides the role shown for a team coach", () => {
    const coaches = effectiveCoaches({ assignments: [{ ...sub, coachId: "c-head", name: "Synthetic Head" }], teamCoaches: [head] });
    expect(coaches).toEqual([{ coachId: "c-head", name: "Synthetic Head", role: "substitute", source: "session" }]);
  });

  it("pending and rejected assignments are not coaches; pending requests are counted", () => {
    const c = coverageOf({ assignments: [{ ...sub, status: "pending" }, { ...asst, status: "rejected" }], teamCoaches: [] });
    expect(c.coverage).toBe("missing");
    expect(c.pendingRequests).toBe(1);
  });

  it("several approved leads are kept and reported (MULTIPLE_LEADS)", () => {
    const c = coverageOf({ assignments: [lead, { ...asst, role: "lead", decidedAt: "2026-11-01T09:00:00Z" }], teamCoaches: [] });
    expect(c.multipleLeads).toBe(true);
    expect(c.ledByName).toBe("Synthetic Assistant"); // earliest approved lead
  });

  it("parses the SQL jsonb the same way", () => {
    const c = parseCoverage({
      coverage: "substitute", led_by_coach_id: "c-lead", led_by_name: "Synthetic Lead", led_by_source: "session",
      coaches: [{ coach_id: "c-lead", name: "Synthetic Lead", role: "lead", source: "session" }, { coach_id: "c-sub", name: "Synthetic Sub", role: "substitute", source: "session" }],
      substitute: true, multiple_leads: false, pending_requests: 2,
    });
    expect(c).toMatchObject({ coverage: "substitute", ledByName: "Synthetic Lead", substitute: true, pendingRequests: 2 });
    expect(coachesByRole(c.coaches)).toEqual([{ role: "lead", names: ["Synthetic Lead"] }, { role: "substitute", names: ["Synthetic Sub"] }]);
    expect(parseCoverage(null).coverage).toBe("assigned");
  });
});

describe("attendance history wording", () => {
  const msg = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en) as string | undefined;

  it("leads with the action", () => {
    expect(historyVerb(null, "present", "draft")).toBe("marked");
    expect(historyVerb("unmarked", "unexcused", "draft")).toBe("marked");
    expect(historyVerb("present", "late", "draft")).toBe("changed");
    expect(historyVerb("unexcused", "late", "correction")).toBe("corrected");
    expect(historyVerb("present", "late", "reopened")).toBe("corrected");
    expect(historyVerb("present", "unmarked", "draft")).toBe("cleared");
  });

  it("English text matches the founder's examples", () => {
    expect(msg(historyWording("unmarked", "present", "draft").actionKey)).toBe("Marked present");
    expect(msg(historyWording("present", "late", "correction").actionKey)).toBe("Corrected to late");
    expect(msg(historyWording(null, "unexcused", "draft").actionKey)).toBe("Marked unexcused absence");
    expect(msg(historyWording(null, "unexcused", "draft").previousKey)).toBe("Not marked");
    expect(msg(historyWording("late", "present", "correction").previousKey)).toBe("Late");
  });

  it("every generated key exists in the catalog", () => {
    const statuses = ["present", "late", "excused", "unexcused", "unmarked"];
    for (const prev of [null, ...statuses]) {
      for (const next of statuses) {
        for (const phase of ["draft", "reopened", "correction"]) {
          const w = historyWording(prev, next, phase);
          expect(msg(w.actionKey), w.actionKey).toBeTypeOf("string");
          expect(msg(w.previousKey), w.previousKey).toBeTypeOf("string");
        }
      }
    }
  });
});

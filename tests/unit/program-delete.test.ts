import { describe, expect, it } from "vitest";
import {
  parseProgramDeleteOutcome,
  parseProgramImpact,
  programErrorKey,
  programImpactLines,
  upcomingSessionHref,
} from "@/lib/programs/program-delete";

// Shape returned by public.program_delete_impact (synthetic values).
const raw = {
  program_id: "p1", name: "Synthetic Camp", kind: "camp", status: "published", previous_status: null,
  counts: { registrations: 2, events: 1 },
  categories: { registrations: 2, bookings: 0, schedules: 1, attendance: 0, invoices: 1, payments: 1, other: 0 },
  total: 5, can_delete: false,
  upcoming_sessions: [
    { id: "e1", kind: "event", title: null, event_type: "training", starts_at: "2027-01-10T17:00:00+00:00", ends_at: "2027-01-10T18:30:00+00:00", all_day: false, status: "scheduled" },
    { id: "c1", kind: "camp_edition", title: "Week 1", event_type: null, starts_at: "2027-07-05", ends_at: "2027-07-09", all_day: true, status: "published" },
    { id: "x", kind: "unknown", starts_at: "2027-01-01" },
  ],
  upcoming_total: 14,
  current_enrollments: [{ id: "r1", kind: "registration", child_name: "Synthetic Child", status: "confirmed" }, { kind: "registration" }],
  current_enrollments_total: 2,
};

describe("program delete helpers", () => {
  it("parses the impact preview", () => {
    const i = parseProgramImpact(raw)!;
    expect(i.programId).toBe("p1");
    expect(i.total).toBe(5);
    expect(i.canDelete).toBe(false);
    expect(i.upcomingSessions.map((s) => s.id)).toEqual(["e1", "c1"]);
    expect(i.upcomingSessions[1].allDay).toBe(true);
    expect(i.upcomingTotal).toBe(14);
    expect(i.currentEnrollments).toEqual([{ id: "r1", kind: "registration", childName: "Synthetic Child", status: "confirmed" }]);
    expect(programImpactLines(i).map((l) => l.key)).toEqual(["registrations", "schedules", "invoices", "payments"]);
  });

  it("never reports deletable when a category is counted", () => {
    const i = parseProgramImpact({ ...raw, can_delete: true })!;
    expect(i.canDelete).toBe(false);
    const empty = parseProgramImpact({ ...raw, can_delete: true, categories: {} })!;
    expect(empty.canDelete).toBe(true);
  });

  it("rejects anything that is not a preview", () => {
    expect(parseProgramImpact(null)).toBeNull();
    expect(parseProgramImpact([])).toBeNull();
    expect(parseProgramImpact({ name: "x" })).toBeNull();
  });

  it("parses the delete outcome (deleted or blocked with fresh counts)", () => {
    expect(parseProgramDeleteOutcome({ ok: true, deleted: true })).toEqual({ deleted: true });
    const blocked = parseProgramDeleteOutcome({ ok: false, deleted: false, code: "PROGRAM_HAS_LINKED_RECORDS", impact: raw });
    expect(blocked && !blocked.deleted && blocked.impact.categories.registrations).toBe(2);
    expect(parseProgramDeleteOutcome({ ok: false })).toBeNull();
  });

  it("links upcoming sessions to the existing review / cancellation pages", () => {
    expect(upcomingSessionHref("p1", { id: "e1", kind: "event" })).toBe("/admin/schedule/e1");
    expect(upcomingSessionHref("p1", { id: "c1", kind: "camp_edition" })).toBe("/admin/programs/p1/editions/c1");
    expect(upcomingSessionHref("p1", { id: "s1", kind: "program_session" })).toBeNull();
  });

  it("maps database errors to message keys", () => {
    expect(programErrorKey("NOT_AUTHORIZED")).toBe("programDelete.errors.forbidden");
    expect(programErrorKey("permission denied for function program_delete")).toBe("programDelete.errors.forbidden");
    expect(programErrorKey("PROGRAM_NOT_FOUND")).toBe("programDelete.errors.notFound");
    expect(programErrorKey("PROGRAM_ALREADY_ARCHIVED")).toBe("programDelete.errors.alreadyArchived");
    expect(programErrorKey("PROGRAM_NOT_ARCHIVED")).toBe("programDelete.errors.notArchived");
    expect(programErrorKey("PROGRAM_ARCHIVED")).toBe("programDelete.errors.archived");
    expect(programErrorKey("PROGRAM_HAS_LINKED_RECORDS")).toBe("programDelete.errors.linked");
    expect(programErrorKey("boom")).toBe("programDelete.errors.failed");
  });
});

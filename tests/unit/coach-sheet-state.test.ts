import { describe, expect, it } from "vitest";
import type { AttendanceSheet, SaveResult, SheetMark } from "@/lib/attendance/types";
import {
  acknowledge, applySaveFailure, applySaveSuccess, countsOf, cycleStatus, effectiveStatus, hasUnsaved, initSheetState,
  markAllPresent, mergeServerSheet, needsAck, nextBatch, resolveConflict, restoreDraft, setStatus, toStoredDraft, unmarkedIds,
} from "@/components/attendance/coach/sheet-state";

// Synthetic fixtures only.
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const C = "00000000-0000-4000-8000-0000000000c3";

function mark(id: string, over: Partial<SheetMark> = {}): SheetMark {
  return {
    mark_id: null, athlete_id: id, first_name: "Synth", last_name: id.slice(-2), jersey_number: null, position: null,
    photo_path: null, is_guest: false, status: "unmarked", finalized_status: null, rev: 0, note: null, updated_by: null,
    updated_by_name: null, updated_at: null, reported_absence_ack: false, reported_absence: null, ...over,
  };
}
function sheet(marks: SheetMark[], version = 1): Pick<AttendanceSheet, "marks" | "sheet"> {
  return {
    marks,
    sheet: { id: "s", status: "draft", version, roster_date: "2026-11-23", led_by_coach_id: null, led_by_name: null, finalized_at: null,
             finalized_by: null, first_finalized_at: null, reopened_at: null, finalize_count: 0, correction_count: 0 },
  };
}
const reported = { report_id: "r1", reason: null, reason_category: "illness" as const, status: "reported" as const,
                   needs_review: false, reporter_kind: "guardian" as const, created_at: "2026-11-23T08:00:00Z" };
function ok(over: Partial<SaveResult>): SaveResult {
  return { ok: true, version: 2, version_conflict: false, replayed: false, applied: [], conflicts: [], warnings: [], ...over };
}
let n = 0;
const ids = () => `req-${++n}`;

describe("coach sheet state: statuses", () => {
  it("every player starts unmarked and unmarked players are detected", () => {
    const s = initSheetState(sheet([mark(A), mark(B), mark(C, { status: "present", rev: 1 })]));
    expect(unmarkedIds(s)).toEqual([A, B]);
    expect(countsOf(s)).toMatchObject({ total: 3, unmarked: 2, present: 1 });
  });

  it("a tap changes the effective status; tapping back to the server value clears it", () => {
    let s = initSheetState(sheet([mark(A)]));
    s = setStatus(s, A, "late");
    expect(effectiveStatus(s, A)).toBe("late");
    expect(hasUnsaved(s)).toBe(true);
    s = setStatus(s, A, "unmarked");
    expect(hasUnsaved(s)).toBe(false);
  });

  it("mark all present only touches unmarked players", () => {
    let s = initSheetState(sheet([mark(A), mark(B, { status: "excused", rev: 1 }), mark(C)]));
    s = setStatus(s, C, "late");
    const r = markAllPresent(s);
    expect(r.changed).toBe(1);
    expect([A, B, C].map((id) => effectiveStatus(r.state, id))).toEqual(["present", "excused", "late"]);
    expect(unmarkedIds(r.state)).toEqual([]);
  });

  it("status cycling wraps and enters from unmarked at either end", () => {
    expect(cycleStatus("unmarked", 1)).toBe("present");
    expect(cycleStatus("unmarked", -1)).toBe("unexcused");
    expect(cycleStatus("present", 1)).toBe("late");
    expect(cycleStatus("unexcused", 1)).toBe("present");
    expect(cycleStatus("present", -1)).toBe("unexcused");
  });

  it("unexcused on a reported absence needs an acknowledgement, which is sent with the save", () => {
    let s = initSheetState(sheet([mark(A, { reported_absence: reported }), mark(B)]));
    expect(needsAck(s, A, "unexcused")).toBe(true);
    expect(needsAck(s, A, "excused")).toBe(false);
    expect(needsAck(s, B, "unexcused")).toBe(false);
    s = acknowledge(s, A);
    expect(needsAck(s, A, "unexcused")).toBe(false);
    s = setStatus(s, A, "unexcused");
    expect(nextBatch(s, ids).batch?.ackReported).toBe(true);
  });
});

describe("coach sheet state: saving", () => {
  it("a retry reuses the inflight request id; later taps wait for the next batch", () => {
    let s = initSheetState(sheet([mark(A), mark(B)]));
    s = setStatus(s, A, "present");
    const first = nextBatch(s, ids);
    s = first.state;
    expect(first.batch?.marks).toEqual([{ athleteId: A, status: "present", baseRev: 0 }]);
    s = setStatus(s, B, "late"); // tapped while the save is on its way
    s = applySaveFailure(s, { retryable: true });
    const retry = nextBatch(s, ids);
    expect(retry.batch?.requestId).toBe(first.batch?.requestId);
    expect(retry.batch?.marks.map((m) => m.athleteId)).toEqual([A]);
    s = applySaveSuccess(retry.state, retry.batch!, ok({ version: 2, applied: [{ athlete_id: A, status: "present", rev: 1 }], replayed: true }));
    expect(s.inflight).toBeNull();
    expect(s.version).toBe(2);
    const next = nextBatch(s, ids);
    expect(next.batch?.requestId).not.toBe(first.batch?.requestId);
    expect(next.batch?.marks).toEqual([{ athleteId: B, status: "late", baseRev: 0 }]);
    expect(next.batch?.expectedVersion).toBe(2);
  });

  it("a refused save drops the batch but keeps the local changes", () => {
    let s = initSheetState(sheet([mark(A)]));
    s = nextBatch(setStatus(s, A, "late"), ids).state;
    s = applySaveFailure(s, { retryable: false });
    expect(s.inflight).toBeNull();
    expect(effectiveStatus(s, A)).toBe("late");
    const again = nextBatch(s, ids);
    expect(again.batch?.marks[0]).toMatchObject({ athleteId: A, status: "late" });
  });

  it("a change made during the save on the same player is kept and rebased", () => {
    let s = initSheetState(sheet([mark(A)]));
    const b = nextBatch(setStatus(s, A, "present"), ids);
    s = setStatus(b.state, A, "unmarked"); // back to the server value while inflight: must still be sent
    s = applySaveSuccess(s, b.batch!, ok({ applied: [{ athlete_id: A, status: "present", rev: 1 }] }));
    expect(effectiveStatus(s, A)).toBe("unmarked");
    expect(s.pending[A]).toEqual({ status: "unmarked", baseRev: 1 });
  });

  it("an ignored or stale result does not touch the state", () => {
    const s = initSheetState(sheet([mark(A)]));
    const b = { requestId: "other", expectedVersion: 1, ackReported: false, marks: [] };
    expect(applySaveSuccess(s, b, ok({}))).toBe(s);
  });
});

describe("coach sheet state: conflicts", () => {
  it("a per-mark conflict keeps the coach's value and blocks it until resolved", () => {
    let s = initSheetState(sheet([mark(A), mark(B)]));
    s = setStatus(setStatus(s, A, "present"), B, "late");
    const b = nextBatch(s, ids);
    s = applySaveSuccess(b.state, b.batch!, ok({
      version: 4, version_conflict: true,
      applied: [{ athlete_id: B, status: "late", rev: 1 }],
      conflicts: [{ athlete_id: A, your_status: "present", current_status: "excused", current_rev: 2, updated_by: "u2",
                    updated_by_name: "Synthetic Other", updated_at: "2026-11-23T10:00:00Z" }],
    }));
    expect(effectiveStatus(s, A)).toBe("present");
    expect(s.conflicts[A]).toMatchObject({ yourStatus: "present", theirStatus: "excused", byName: "Synthetic Other" });
    expect(nextBatch(s, ids).batch).toBeNull(); // not re-sent while conflicted

    const mine = resolveConflict(s, A, "mine");
    expect(nextBatch(mine, ids).batch?.marks).toEqual([{ athleteId: A, status: "present", baseRev: 2 }]);
    const theirs = resolveConflict(s, A, "theirs");
    expect(effectiveStatus(theirs, A)).toBe("excused");
    expect(hasUnsaved(theirs)).toBe(false);
  });

  it("tapping a conflicted player resolves the conflict with the tapped value", () => {
    let s = initSheetState(sheet([mark(A)]));
    const b = nextBatch(setStatus(s, A, "present"), ids);
    s = applySaveSuccess(b.state, b.batch!, ok({ conflicts: [{ athlete_id: A, your_status: "present", current_status: "late",
      current_rev: 3, updated_by: "u2", updated_by_name: null, updated_at: "2026-11-23T10:00:00Z" }] }));
    s = setStatus(s, A, "excused");
    expect(s.conflicts[A]).toBeUndefined();
    expect(s.pending[A]).toEqual({ status: "excused", baseRev: 3 });
  });

  it("merging a reloaded sheet keeps local changes, adds guests, drops removed players", () => {
    let s = initSheetState(sheet([mark(A), mark(B)]));
    s = setStatus(setStatus(s, A, "late"), B, "present");
    s = mergeServerSheet(s, sheet([mark(A, { status: "present", rev: 1 }), mark(C, { is_guest: true })], 5));
    expect(s.order).toEqual([A, C]);
    expect(effectiveStatus(s, A)).toBe("late");
    expect(s.pending[B]).toBeUndefined();
    expect(effectiveStatus(s, C)).toBe("unmarked");
    expect(s.version).toBe(5);
    // A local change equal to the new server value is dropped.
    const same = mergeServerSheet(setStatus(s, A, "present"), sheet([mark(A, { status: "present", rev: 1 })], 6));
    expect(hasUnsaved(same)).toBe(false);
  });
});

describe("coach sheet state: local draft", () => {
  it("a stored draft restores pending changes and the inflight request id", () => {
    let s = initSheetState(sheet([mark(A), mark(B)]));
    s = nextBatch(setStatus(s, A, "present"), ids).state;
    s = setStatus(s, B, "excused");
    const stored = JSON.parse(JSON.stringify(toStoredDraft(s, 1)));
    const fresh = restoreDraft(initSheetState(sheet([mark(A), mark(B)])), stored);
    expect(fresh.inflight?.requestId).toBe(s.inflight?.requestId);
    expect(effectiveStatus(fresh, A)).toBe("present");
    expect(effectiveStatus(fresh, B)).toBe("excused");
    expect(nextBatch(fresh, ids).batch?.requestId).toBe(s.inflight?.requestId);
  });

  it("invalid or foreign drafts are ignored", () => {
    const s = initSheetState(sheet([mark(A)]));
    expect(restoreDraft(s, null)).toBe(s);
    expect(restoreDraft(s, { v: 2 })).toBe(s);
    const r = restoreDraft(s, { v: 1, pending: { [A]: { status: "bogus", baseRev: 0 }, [C]: { status: "present", baseRev: 0 } }, acks: {}, inflight: null });
    expect(hasUnsaved(r)).toBe(false);
    expect(toStoredDraft(s)).toBeNull();
  });
});

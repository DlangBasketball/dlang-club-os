import {
  FINAL_STATUSES,
  type AttendanceSheet,
  type FinalStatus,
  type MarkStatus,
  type SaveResult,
} from "@/lib/attendance/types";

/*
 * Client state of the coach attendance sheet (pure, no I/O, unit-tested in
 * tests/unit/coach-sheet-state.test.ts).
 *
 * - `server` is the last known server value of each mark (status + rev).
 * - `pending` holds the coach's local changes that the server has not
 *   confirmed yet. A tap never waits for the network; it only edits pending.
 * - `inflight` is the save request on the way. It is frozen: a retry (after a
 *   network failure, a reload with the draft restored, a double tap) resends
 *   the SAME batch with the SAME request id, so the server replays it instead
 *   of applying it twice. Changes made meanwhile wait for the next batch.
 * - `conflicts` are marks another user changed after this coach loaded them
 *   (attendance_save per-mark merge). The coach's value stays in pending and
 *   is not sent again until the coach keeps it or takes the other value.
 */
export type ServerMark = { status: MarkStatus; rev: number; updatedByName: string | null; updatedAt: string | null };
export type PendingMark = { status: MarkStatus; baseRev: number };
export type MarkConflict = {
  yourStatus: MarkStatus; theirStatus: MarkStatus; theirRev: number; byName: string | null; at: string | null;
};
export type BatchMark = { athleteId: string; status: MarkStatus; baseRev: number };
export type SaveBatch = { requestId: string; expectedVersion: number; ackReported: boolean; marks: BatchMark[] };

export type SheetState = {
  version: number;
  order: string[];
  /** Athletes with an active absence report (reported / acknowledged). */
  reported: Record<string, true>;
  server: Record<string, ServerMark>;
  pending: Record<string, PendingMark>;
  conflicts: Record<string, MarkConflict>;
  /** Reported absences the coach confirmed as unexcused (REPORTED_ABSENCE). */
  acks: Record<string, true>;
  inflight: SaveBatch | null;
};

type SheetLike = Pick<AttendanceSheet, "marks" | "sheet">;

function serverFrom(sheet: SheetLike): Pick<SheetState, "order" | "reported" | "server"> {
  const server: Record<string, ServerMark> = {};
  const reported: Record<string, true> = {};
  const order: string[] = [];
  for (const m of sheet.marks) {
    order.push(m.athlete_id);
    server[m.athlete_id] = { status: m.status, rev: m.rev, updatedByName: m.updated_by_name, updatedAt: m.updated_at };
    if (m.reported_absence) reported[m.athlete_id] = true;
  }
  return { order, reported, server };
}

export function initSheetState(sheet: SheetLike): SheetState {
  const acks: Record<string, true> = {};
  for (const m of sheet.marks) if (m.reported_absence && m.reported_absence_ack && m.status === "unexcused") acks[m.athlete_id] = true;
  return { version: sheet.sheet?.version ?? 1, ...serverFrom(sheet), pending: {}, conflicts: {}, acks, inflight: null };
}

/** What the coach sees for a player: the local change, else the server value. */
export function effectiveStatus(s: SheetState, athleteId: string): MarkStatus {
  return s.pending[athleteId]?.status ?? s.server[athleteId]?.status ?? "unmarked";
}

/** Unexcused on a player with a reported absence needs an explicit acknowledgement first. */
export function needsAck(s: SheetState, athleteId: string, status: MarkStatus): boolean {
  return status === "unexcused" && Boolean(s.reported[athleteId]) && !s.acks[athleteId];
}

export function acknowledge(s: SheetState, athleteId: string): SheetState {
  return { ...s, acks: { ...s.acks, [athleteId]: true } };
}

function inInflight(s: SheetState, athleteId: string): boolean {
  return Boolean(s.inflight?.marks.some((m) => m.athleteId === athleteId));
}

/**
 * The coach taps a status. A tap on a conflicted mark resolves the conflict
 * in favour of the tapped value (based on the other user's revision).
 */
export function setStatus(s: SheetState, athleteId: string, status: MarkStatus): SheetState {
  const srv = s.server[athleteId];
  if (!srv) return s;
  const pending = { ...s.pending };
  const conflicts = { ...s.conflicts };
  delete conflicts[athleteId];
  if (status === srv.status && !inInflight(s, athleteId)) delete pending[athleteId];
  else pending[athleteId] = { status, baseRev: srv.rev };
  return { ...s, pending, conflicts };
}

/** Every player still unmarked becomes present; marked players keep their value. */
export function markAllPresent(s: SheetState): { state: SheetState; changed: number } {
  let next = s;
  let changed = 0;
  for (const id of s.order) {
    if (effectiveStatus(next, id) === "unmarked") {
      next = setStatus(next, id, "present");
      changed++;
    }
  }
  return { state: next, changed };
}

export function unmarkedIds(s: SheetState): string[] {
  return s.order.filter((id) => effectiveStatus(s, id) === "unmarked");
}

export function hasUnsaved(s: SheetState): boolean {
  return Boolean(s.inflight) || Object.keys(s.pending).length > 0;
}

export function countsOf(s: SheetState): Record<MarkStatus, number> & { total: number } {
  const c = { total: s.order.length, unmarked: 0, present: 0, late: 0, excused: 0, unexcused: 0 };
  for (const id of s.order) c[effectiveStatus(s, id)]++;
  return c;
}

/**
 * The batch to send now. An inflight batch is returned unchanged (same request
 * id) so a retry can never apply twice; otherwise a new batch is built from
 * pending (conflicted marks excluded) with `makeId()`. Null when nothing to send.
 */
export function nextBatch(s: SheetState, makeId: () => string): { state: SheetState; batch: SaveBatch | null } {
  if (s.inflight) return { state: s, batch: s.inflight };
  const marks: BatchMark[] = s.order
    .filter((id) => s.pending[id] && !s.conflicts[id])
    .map((id) => ({ athleteId: id, status: s.pending[id].status, baseRev: s.pending[id].baseRev }));
  if (!marks.length) return { state: s, batch: null };
  const batch: SaveBatch = {
    requestId: makeId(),
    expectedVersion: s.version,
    ackReported: marks.some((m) => m.status === "unexcused" && s.acks[m.athleteId]),
    marks,
  };
  return { state: { ...s, inflight: batch }, batch };
}

/** Apply a successful (or replayed) attendance_save result of `batch`. */
export function applySaveSuccess(s: SheetState, batch: SaveBatch, result: SaveResult): SheetState {
  if (!s.inflight || s.inflight.requestId !== batch.requestId) return s;
  const server = { ...s.server };
  const pending = { ...s.pending };
  const conflicts = { ...s.conflicts };
  const applied = new Map(result.applied.map((a) => [a.athlete_id, a]));
  const conflicted = new Map(result.conflicts.map((c) => [c.athlete_id, c]));
  for (const m of batch.marks) {
    const cur = server[m.athleteId];
    if (!cur) continue;
    const a = applied.get(m.athleteId);
    const c = conflicted.get(m.athleteId);
    const stillSame = pending[m.athleteId]?.status === m.status;
    if (a) {
      server[m.athleteId] = { ...cur, status: a.status, rev: a.rev, updatedByName: null, updatedAt: null };
      if (stillSame) delete pending[m.athleteId];
      else if (pending[m.athleteId]) pending[m.athleteId] = { ...pending[m.athleteId], baseRev: a.rev };
    } else if (c) {
      server[m.athleteId] = { status: c.current_status, rev: c.current_rev, updatedByName: c.updated_by_name, updatedAt: c.updated_at };
      const mine = pending[m.athleteId]?.status ?? c.your_status;
      if (mine === c.current_status) delete pending[m.athleteId];
      else {
        pending[m.athleteId] = { status: mine, baseRev: pending[m.athleteId]?.baseRev ?? m.baseRev };
        conflicts[m.athleteId] = { yourStatus: mine, theirStatus: c.current_status, theirRev: c.current_rev,
                                   byName: c.updated_by_name, at: c.updated_at };
      }
    } else {
      // No-op on the server: it already had this value.
      server[m.athleteId] = { ...cur, status: m.status };
      if (stillSame) delete pending[m.athleteId];
    }
  }
  return { ...s, version: Math.max(s.version, result.version), server, pending, conflicts, inflight: null };
}

/**
 * A save failed. Network / server-unreachable errors keep the inflight batch
 * (the retry reuses its request id). A refusal by the server drops the batch
 * but keeps every local change in pending, so nothing the coach tapped is lost.
 */
export function applySaveFailure(s: SheetState, opts: { retryable: boolean }): SheetState {
  return opts.retryable ? s : { ...s, inflight: null };
}

export function resolveConflict(s: SheetState, athleteId: string, keep: "mine" | "theirs"): SheetState {
  const c = s.conflicts[athleteId];
  if (!c) return s;
  const conflicts = { ...s.conflicts };
  delete conflicts[athleteId];
  const pending = { ...s.pending };
  if (keep === "mine") pending[athleteId] = { status: c.yourStatus, baseRev: c.theirRev };
  else delete pending[athleteId];
  return { ...s, conflicts, pending };
}

/**
 * Merge a freshly loaded sheet (after a version conflict, a guest change or a
 * reload) without losing local changes: server values and order are replaced,
 * pending changes stay unless the server already has the same value, and
 * changes of players no longer on the sheet are dropped.
 */
export function mergeServerSheet(s: SheetState, sheet: SheetLike): SheetState {
  const base = serverFrom(sheet);
  const pending: Record<string, PendingMark> = {};
  for (const [id, p] of Object.entries(s.pending)) {
    const srv = base.server[id];
    if (!srv) continue;
    if (srv.status === p.status && !inInflight(s, id)) continue;
    pending[id] = p;
  }
  const conflicts: Record<string, MarkConflict> = {};
  for (const [id, c] of Object.entries(s.conflicts)) if (pending[id]) conflicts[id] = c;
  const acks = { ...s.acks };
  for (const m of sheet.marks) if (m.reported_absence && m.reported_absence_ack && m.status === "unexcused") acks[m.athlete_id] = true;
  return { ...s, ...base, version: Math.max(s.version, sheet.sheet?.version ?? s.version), pending, conflicts, acks };
}

/** Arrow-key navigation through the four statuses (unmarked enters at either end). */
export function cycleStatus(current: MarkStatus, dir: 1 | -1): FinalStatus {
  const i = FINAL_STATUSES.indexOf(current as FinalStatus);
  if (i < 0) return dir === 1 ? FINAL_STATUSES[0] : FINAL_STATUSES[FINAL_STATUSES.length - 1];
  return FINAL_STATUSES[(i + dir + FINAL_STATUSES.length) % FINAL_STATUSES.length];
}

// ---------------------------------------------------------------------------
// Local draft (survives a reload / a dead battery: ids and statuses only)
// ---------------------------------------------------------------------------
export type StoredDraft = {
  v: 1; pending: Record<string, PendingMark>; acks: Record<string, true>; inflight: SaveBatch | null; savedAt: number;
};

export function toStoredDraft(s: SheetState, now = Date.now()): StoredDraft | null {
  if (!hasUnsaved(s)) return null;
  return { v: 1, pending: s.pending, acks: s.acks, inflight: s.inflight, savedAt: now };
}

const STATUS_SET = new Set<string>(["unmarked", ...FINAL_STATUSES]);

/** Restore a stored draft onto a freshly loaded sheet (invalid entries ignored). */
export function restoreDraft(s: SheetState, raw: unknown): SheetState {
  if (!raw || typeof raw !== "object" || (raw as StoredDraft).v !== 1) return s;
  const d = raw as StoredDraft;
  const pending = { ...s.pending };
  for (const [id, p] of Object.entries(d.pending ?? {})) {
    const srv = s.server[id];
    if (!srv || !p || !STATUS_SET.has(p.status) || typeof p.baseRev !== "number") continue;
    if (srv.status === p.status) continue;
    pending[id] = { status: p.status, baseRev: p.baseRev };
  }
  const acks = { ...s.acks };
  for (const id of Object.keys(d.acks ?? {})) if (s.server[id]) acks[id] = true;
  let inflight = s.inflight;
  const b = d.inflight;
  if (!inflight && b && typeof b.requestId === "string" && Array.isArray(b.marks)
      && b.marks.every((m) => s.server[m.athleteId] && STATUS_SET.has(m.status))) {
    inflight = { requestId: b.requestId, expectedVersion: Number(b.expectedVersion) || s.version, ackReported: Boolean(b.ackReported), marks: b.marks };
    for (const m of b.marks) if (!pending[m.athleteId] && s.server[m.athleteId].status !== m.status) pending[m.athleteId] = { status: m.status, baseRev: m.baseRev };
  }
  return { ...s, pending, acks, inflight };
}

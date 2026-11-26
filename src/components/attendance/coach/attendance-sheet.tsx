"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCheck, CloudOff, Loader2, UserPlus, X } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { Label, Select } from "@/components/ui/input";
import { finalizeAttendance, openAttendance, removeGuest, saveAttendance } from "@/lib/actions/team-attendance";
import type { AttendanceSheet, FinalStatus, FinalizeResult, MarkStatus, SheetMark } from "@/lib/attendance/types";
import { newRequestId } from "@/lib/billing/request-id";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import {
  acknowledge, applySaveFailure, applySaveSuccess, countsOf, effectiveStatus, hasUnsaved, initSheetState, markAllPresent,
  mergeServerSheet, needsAck, nextBatch, resolveConflict, restoreDraft, setStatus, toStoredDraft, unmarkedIds, type SheetState,
} from "./sheet-state";
import { StatusPicker } from "./status-picker";
import { GuestDialog } from "./guest-dialog";
import { ModalDialog } from "./modal-dialog";
import { ReportedAbsenceNote } from "./reported-absence";
import { draftStorageKey } from "./draft-storage";

type SaveUi = "idle" | "saving" | "saved" | "failed" | "offline" | "refused";
type CoachOption = { id: string; name: string };

/**
 * The coach attendance sheet (draft / reopened). Every tap is local first and
 * saved in the background (debounced, per-mark merge, one request id per
 * batch, reused on retry). Local changes survive a failed save, a reload and
 * going offline (kept on this device until the server confirms them).
 */
export function CoachAttendanceSheet({
  eventId, initialSheet, coaches, myCoachId, defaultLeadId = null, userId,
}: {
  eventId: string;
  initialSheet: AttendanceSheet;
  coaches: CoachOption[];
  myCoachId: string | null;
  /** Approved lead of the session (session lead > booked coach > team head): the Led-by default. */
  defaultLeadId?: string | null;
  userId: string;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const storageKey = draftStorageKey(userId, eventId);

  const [sheet, setSheet] = React.useState(initialSheet);
  const [state, setState] = React.useState<SheetState>(() => initSheetState(initialSheet));
  const stateRef = React.useRef(state);
  const commit = React.useCallback((next: SheetState) => { stateRef.current = next; setState(next); }, []);

  const [saveUi, setSaveUi] = React.useState<SaveUi>("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [ackFor, setAckFor] = React.useState<string | null>(null);
  const [guestOpen, setGuestOpen] = React.useState(false);
  const [finalOpen, setFinalOpen] = React.useState(false);
  const [ledBy, setLedBy] = React.useState<string>(initialSheet.sheet?.led_by_coach_id ?? defaultLeadId ?? myCoachId ?? "");
  const [restored, setRestored] = React.useState(false);

  const byId = React.useMemo(() => new Map(sheet.marks.map((m) => [m.athlete_id, m])), [sheet.marks]);
  const nameOf = React.useCallback((id: string) => {
    const m = byId.get(id);
    return m ? `${m.first_name} ${m.last_name}` : "";
  }, [byId]);

  // Restore a draft kept on this device (after a reload / offline / crash).
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const next = restoreDraft(stateRef.current, JSON.parse(raw));
        if (next !== stateRef.current && hasUnsaved(next)) { commit(next); setRestored(true); }
      }
    } catch { /* storage unavailable: nothing to restore */ }
  }, [storageKey, commit]);

  // Keep unsaved work on this device (athlete ids and statuses only).
  React.useEffect(() => {
    try {
      const d = toStoredDraft(state);
      if (d) window.localStorage.setItem(storageKey, JSON.stringify(d));
      else window.localStorage.removeItem(storageKey);
    } catch { /* quota / private mode: the in-memory state still holds the changes */ }
  }, [state, storageKey]);

  const reload = React.useCallback(async () => {
    try {
      const r = await openAttendance(eventId);
      if (!r.ok || !r.data) return;
      const fresh = r.data as unknown as AttendanceSheet;
      if (fresh.sheet?.status === "final" || !fresh.access.can_edit) { router.refresh(); return; }
      setSheet(fresh);
      commit(mergeServerSheet(stateRef.current, fresh));
    } catch { /* offline: keep what we have */ }
  }, [eventId, commit, router]);

  // ---- background save -------------------------------------------------------
  const running = React.useRef<Promise<boolean> | null>(null);
  const flush = React.useCallback((): Promise<boolean> => {
    if (running.current) return running.current;
    const p = (async () => {
      try {
        for (;;) {
          const { state: s1, batch } = nextBatch(stateRef.current, newRequestId);
          if (!batch) {
            const clean = Object.keys(stateRef.current.conflicts).length === 0;
            setSaveUi(clean ? "saved" : "idle");
            return clean;
          }
          commit(s1);
          setSaveUi("saving");
          setSaveError(null);
          let res: Awaited<ReturnType<typeof saveAttendance>>;
          try {
            res = await saveAttendance({
              eventId, expectedVersion: batch.expectedVersion, requestId: batch.requestId, ackReported: batch.ackReported,
              marks: batch.marks.map((m) => ({ athleteId: m.athleteId, status: m.status, baseRev: m.baseRev })),
            });
          } catch {
            commit(applySaveFailure(stateRef.current, { retryable: true }));
            setSaveUi(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "failed");
            return false;
          }
          if (!res.ok || !res.data) {
            const retryable = !res.ok && !res.code;
            commit(applySaveFailure(stateRef.current, { retryable }));
            setSaveError(res.ok ? null : res.error);
            setSaveUi(retryable ? "failed" : "refused");
            if (!res.ok && (res.code === "SHEET_FINAL" || res.code === "EVENT_CANCELLED")) router.refresh();
            return false;
          }
          commit(applySaveSuccess(stateRef.current, batch, res.data));
          if (res.data.version_conflict || res.data.conflicts.length) {
            setNotice(t("coachTrainings.sheet.save.merged"));
            await reload();
          }
        }
      } finally {
        running.current = null;
      }
    })();
    running.current = p;
    return p;
  }, [commit, eventId, reload, router, t]);

  // Autosave: shortly after the last tap, when the tab is hidden, when back online.
  const pendingKey = React.useMemo(() => JSON.stringify(state.pending), [state.pending]);
  React.useEffect(() => {
    if (pendingKey === "{}") return;
    const h = window.setTimeout(() => { void flush(); }, 1200);
    return () => window.clearTimeout(h);
  }, [pendingKey, flush]);
  React.useEffect(() => {
    const onOnline = () => { void flush(); };
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    const onUnload = (e: BeforeUnloadEvent) => { if (hasUnsaved(stateRef.current)) e.preventDefault(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [flush]);

  // ---- taps -----------------------------------------------------------------------
  function choose(athleteId: string, status: FinalStatus) {
    if (needsAck(stateRef.current, athleteId, status)) { setAckFor(athleteId); return; }
    commit(setStatus(stateRef.current, athleteId, status));
    if (saveUi === "saved") setSaveUi("idle");
  }
  function confirmAck() {
    if (!ackFor) return;
    commit(setStatus(acknowledge(stateRef.current, ackFor), ackFor, "unexcused"));
    setAckFor(null);
  }
  function allPresent() {
    const r = markAllPresent(stateRef.current);
    commit(r.state);
    setNotice(t("coachTrainings.sheet.markedAll", { count: r.changed }));
  }
  function discardLocal() {
    const s = stateRef.current;
    commit({ ...s, pending: {}, conflicts: {}, inflight: null });
    setSaveUi("idle");
    setSaveError(null);
    setRestored(false);
  }
  async function dropGuest(athleteId: string) {
    setNotice(null);
    const r = await removeGuest({ eventId, athleteId }).catch(() => null);
    if (!r) { setNotice(t("coachTrainings.sheet.save.failed")); return; }
    if (!r.ok) { setNotice(r.error); return; }
    await reload();
  }

  const counts = countsOf(state);
  const unmarked = unmarkedIds(state);
  const conflictIds = Object.keys(state.conflicts);
  const unsavedCount = Object.keys(state.pending).length;
  const marked = counts.total - counts.unmarked;

  return (
    <div className="pb-44">
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-text-secondary" aria-live="polite">
          {t("coachTrainings.sheet.progress", { marked, total: counts.total })}
        </p>
        <Button type="button" variant="secondary" size="lg" onClick={allPresent} disabled={counts.unmarked === 0}
                title={t("coachTrainings.sheet.markAllHint")}>
          <CheckCheck className="h-5 w-5" aria-hidden /> {t("coachTrainings.sheet.markAllPresent")}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={() => setGuestOpen(true)}>
          <UserPlus className="h-5 w-5" aria-hidden /> {t("coachTrainings.guests.add")}
        </Button>
      </div>
      <p className="mb-3 text-xs text-text-muted">{t("coachTrainings.sheet.markAllHint")}</p>

      <div aria-live="polite" className="space-y-2">
        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-info/30 bg-info-soft p-3 text-sm text-text">
            <span>{notice}</span>
            <button type="button" className="touch-target shrink-0 text-text-muted hover:text-text" onClick={() => setNotice(null)}
                    aria-label={t("coachTrainings.common.dismiss")}><X className="h-4 w-4" aria-hidden /></button>
          </div>
        )}
        {restored && (
          <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-text">
            {t("coachTrainings.sheet.save.restored")}
          </div>
        )}
        {conflictIds.length > 0 && (
          <div role="alert" className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-text">
            {t("coachTrainings.conflict.banner", { count: conflictIds.length })}
          </div>
        )}
      </div>

      {/* Players */}
      {sheet.marks.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-sm text-text-muted">
          {t("coachTrainings.sheet.noRoster")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {sheet.marks.map((m) => (
            <PlayerRow
              key={m.athlete_id}
              mark={m}
              status={effectiveStatus(state, m.athlete_id)}
              unsaved={Boolean(state.pending[m.athlete_id]) && (saveUi === "failed" || saveUi === "offline" || saveUi === "refused")}
              conflict={state.conflicts[m.athlete_id] ?? null}
              onChoose={(s) => choose(m.athlete_id, s)}
              onKeepMine={() => commit(resolveConflict(stateRef.current, m.athlete_id, "mine"))}
              onTakeTheirs={() => commit(resolveConflict(stateRef.current, m.athlete_id, "theirs"))}
              canRemoveGuest={m.is_guest && m.rev === 0 && m.status === "unmarked" && !state.pending[m.athlete_id]}
              onRemoveGuest={() => dropGuest(m.athlete_id)}
            />
          ))}
        </ul>
      )}

      {/* Sticky save / finalize bar */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-2xl border-t border-border bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center">
          <SaveStatus ui={saveUi} unsaved={unsavedCount} error={saveError} />
          <div className="flex gap-2 sm:ml-auto">
            {(saveUi === "failed" || saveUi === "offline") && (
              <Button type="button" variant="secondary" size="lg" onClick={() => void flush()}>{t("coachTrainings.sheet.save.retry")}</Button>
            )}
            {saveUi === "refused" && (
              <Button type="button" variant="ghost" size="lg" onClick={discardLocal}>{t("coachTrainings.sheet.save.discard")}</Button>
            )}
            {saveUi !== "failed" && saveUi !== "offline" && saveUi !== "refused" && (
              <Button type="button" variant="secondary" size="lg" onClick={() => void flush()} disabled={!hasUnsaved(state)}>
                {t("coachTrainings.sheet.save.saveNow")}
              </Button>
            )}
            <Button type="button" size="lg" className="flex-1 sm:flex-none" onClick={() => setFinalOpen(true)}>
              {t("coachTrainings.finalize.open")}
            </Button>
          </div>
        </div>
      </div>

      <ModalDialog open={ackFor !== null} onClose={() => setAckFor(null)}
                   title={ackFor ? t("coachTrainings.sheet.ackTitle", { name: nameOf(ackFor) }) : ""}>
        {ackFor && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">{t("coachTrainings.sheet.ackBody", { name: nameOf(ackFor) })}</p>
            {byId.get(ackFor)?.reported_absence && <ReportedAbsenceNote report={byId.get(ackFor)!.reported_absence!} />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" size="lg" onClick={() => setAckFor(null)}>{t("coachTrainings.common.cancel")}</Button>
              <Button type="button" variant="danger" size="lg" onClick={confirmAck}>{t("coachTrainings.sheet.ackConfirm")}</Button>
            </div>
          </div>
        )}
      </ModalDialog>

      <GuestDialog open={guestOpen} onClose={() => setGuestOpen(false)} eventId={eventId}
                   onAdded={async (name) => { setNotice(t("coachTrainings.guests.added", { name })); await reload(); }} />

      <FinalizePanel
        open={finalOpen}
        onClose={() => setFinalOpen(false)}
        eventId={eventId}
        flush={flush}
        stateRef={stateRef}
        counts={counts}
        unmarked={unmarked}
        conflicts={conflictIds.length}
        nameOf={nameOf}
        coaches={coaches}
        ledBy={ledBy}
        setLedBy={setLedBy}
        reload={reload}
        onDone={() => {
          try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
          router.refresh();
        }}
        formatCount={(n) => f.number(n)}
      />
    </div>
  );
}

function SaveStatus({ ui, unsaved, error }: { ui: SaveUi; unsaved: number; error: string | null }) {
  const t = useT();
  let body: React.ReactNode;
  if (ui === "saving") body = <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("coachTrainings.sheet.save.saving")}</>;
  else if (ui === "offline") body = <><CloudOff className="h-4 w-4 text-warning" aria-hidden /> {t("coachTrainings.sheet.save.offline")}</>;
  else if (ui === "failed") body = <><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> {t("coachTrainings.sheet.save.failed")}</>;
  else if (ui === "refused") body = <><AlertTriangle className="h-4 w-4 text-danger" aria-hidden /> {t("coachTrainings.sheet.save.refused", { error: error ?? "" })}</>;
  else if (unsaved > 0) body = t("coachTrainings.sheet.save.unsaved", { count: unsaved });
  else if (ui === "saved") body = t("coachTrainings.sheet.save.saved");
  else body = null;
  return (
    <p role="status" aria-live="polite" className="flex min-h-[1.5rem] items-center gap-2 text-sm text-text-secondary">
      {body}
    </p>
  );
}

function PlayerRow({
  mark, status, unsaved, conflict, onChoose, onKeepMine, onTakeTheirs, canRemoveGuest, onRemoveGuest,
}: {
  mark: SheetMark;
  status: MarkStatus;
  unsaved: boolean;
  conflict: SheetState["conflicts"][string] | null;
  onChoose: (s: FinalStatus) => void;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  canRemoveGuest: boolean;
  onRemoveGuest: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const name = `${mark.first_name} ${mark.last_name}`;
  const statusLabel = (s: MarkStatus) => t(`teamAttendance.statuses.${s}`);
  return (
    <li id={`player-${mark.athlete_id}`} tabIndex={-1}
        className={cn("rounded-lg border bg-surface p-3 focus:outline-none focus-visible:shadow-focus",
                      status === "unmarked" ? "border-border" : "border-border-strong",
                      conflict && "border-warning")}>
      <div className="mb-2 flex items-center gap-3">
        <Avatar name={name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-text">
            {mark.jersey_number !== null && (
              <span className="mr-1.5 font-mono text-text-muted">{t("coachTrainings.sheet.jersey", { number: mark.jersey_number })}</span>
            )}
            {name}
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
            {status === "unmarked"
              ? <Badge tone="neutral">{statusLabel("unmarked")}</Badge>
              : <span className="sr-only">{statusLabel(status)}</span>}
            {mark.is_guest && <Badge tone="accent">{t("coachTrainings.sheet.guest")}</Badge>}
            {unsaved && <Badge tone="warning">{t("coachTrainings.sheet.notSaved")}</Badge>}
          </p>
        </div>
        {canRemoveGuest && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemoveGuest}>{t("coachTrainings.guests.remove")}</Button>
        )}
      </div>
      {mark.reported_absence && <div className="mb-2"><ReportedAbsenceNote report={mark.reported_absence} /></div>}
      {conflict && (
        <div role="alert" className="mb-2 rounded-md border border-warning/30 bg-warning-soft p-2.5 text-sm text-text">
          <p>
            {t("coachTrainings.conflict.body", {
              by: conflict.byName ?? t("coachTrainings.conflict.bySomeone"),
              theirs: statusLabel(conflict.theirStatus),
              mine: statusLabel(conflict.yourStatus),
              time: conflict.at ? f.time(conflict.at) : "",
            })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onKeepMine}>
              {t("coachTrainings.conflict.keepMine", { status: statusLabel(conflict.yourStatus) })}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onTakeTheirs}>
              {t("coachTrainings.conflict.takeTheirs", { status: statusLabel(conflict.theirStatus) })}
            </Button>
          </div>
        </div>
      )}
      <StatusPicker value={status} onChange={onChoose} label={t("coachTrainings.sheet.statusGroup", { name })} />
    </li>
  );
}

function focusPlayer(athleteId: string) {
  const el = document.getElementById(`player-${athleteId}`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  (el.querySelector<HTMLElement>("[role=radio][tabindex='0']") ?? el).focus({ preventScroll: true });
}

function FinalizePanel({
  open, onClose, eventId, flush, stateRef, counts, unmarked, conflicts, nameOf, coaches, ledBy, setLedBy, reload, onDone, formatCount,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  flush: () => Promise<boolean>;
  stateRef: React.MutableRefObject<SheetState>;
  counts: ReturnType<typeof countsOf>;
  unmarked: string[];
  conflicts: number;
  nameOf: (id: string) => string;
  coaches: CoachOption[];
  ledBy: string;
  setLedBy: (v: string) => void;
  reload: () => Promise<void>;
  onDone: () => void;
  formatCount: (n: number) => string;
}) {
  const t = useT();
  const [phase, setPhase] = React.useState<"saving" | "ready" | "working">("saving");
  const [error, setError] = React.useState<string | null>(null);
  const [reported, setReported] = React.useState<{ athlete_id: string; first_name: string; last_name: string }[] | null>(null);
  const requestId = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    requestId.current = newRequestId();
    setError(null);
    setReported(null);
    setPhase("saving");
    let live = true;
    flush().then((ok) => {
      if (!live) return;
      if (!ok) setError(t("coachTrainings.finalize.saveFailed"));
      setPhase("ready");
    });
    return () => { live = false; };
  }, [open, flush, t]);

  async function submit(ack: boolean) {
    setPhase("working");
    setError(null);
    const saved = await flush();
    if (!saved) { setPhase("ready"); setError(t("coachTrainings.finalize.saveFailed")); return; }
    let res: Awaited<ReturnType<typeof finalizeAttendance>>;
    try {
      res = await finalizeAttendance({
        eventId, ledByCoachId: ledBy || null, expectedVersion: stateRef.current.version,
        requestId: requestId.current ?? newRequestId(), ackReported: ack,
      });
    } catch {
      setPhase("ready");
      setError(t("coachTrainings.finalize.networkFailed"));
      return;
    }
    if (!res.ok || !res.data) { setPhase("ready"); setError(res.ok ? t("coachTrainings.finalize.networkFailed") : res.error); return; }
    const r: FinalizeResult = res.data;
    if (r.ok) { onDone(); return; }
    setPhase("ready");
    if (r.code === "VERSION_CONFLICT") { setError(t("coachTrainings.finalize.versionConflict")); await reload(); }
    else if (r.code === "UNMARKED_PLAYERS") { setError(t("teamAttendance.errors.UNMARKED_PLAYERS")); await reload(); }
    else if (r.code === "REPORTED_ABSENCE_UNACKNOWLEDGED") setReported(r.athletes);
  }

  const blocked = unmarked.length > 0 || conflicts > 0;
  const rows: { key: FinalStatus; n: number }[] = [
    { key: "present", n: counts.present }, { key: "late", n: counts.late },
    { key: "excused", n: counts.excused }, { key: "unexcused", n: counts.unexcused },
  ];

  return (
    <ModalDialog open={open} onClose={onClose} title={t("coachTrainings.finalize.title")} size="lg">
      <div className="space-y-5">
        {phase === "saving" && (
          <p role="status" className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("coachTrainings.finalize.saveFirst")}
          </p>
        )}
        <section aria-labelledby="fin-summary">
          <h3 id="fin-summary" className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">{t("coachTrainings.finalize.summary")}</h3>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {rows.map((r) => (
              <div key={r.key} className="rounded-md border border-border bg-surface-elevated p-3">
                <dt className="text-xs text-text-muted">{t(`coachTrainings.statusShort.${r.key}`)}</dt>
                <dd className="font-display text-2xl text-text">{formatCount(r.n)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-text-secondary">{t("coachTrainings.finalize.players", { count: counts.total })}</p>
        </section>

        {unmarked.length > 0 && (
          <section aria-labelledby="fin-unmarked" className="rounded-md border border-warning/30 bg-warning-soft p-3">
            <h3 id="fin-unmarked" className="font-medium text-text">{t("coachTrainings.finalize.unmarkedTitle", { count: unmarked.length })}</h3>
            <p className="mb-2 text-sm text-text-secondary">{t("coachTrainings.finalize.unmarkedHint")}</p>
            <ul className="space-y-1">
              {unmarked.map((id) => (
                <li key={id}>
                  <button type="button" className="touch-target text-left text-sm text-brand-primary underline-offset-4 hover:underline"
                          onClick={() => { onClose(); window.setTimeout(() => focusPlayer(id), 50); }}>
                    {t("coachTrainings.finalize.jumpTo", { name: nameOf(id) })}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {conflicts > 0 && <p role="alert" className="text-sm text-warning">{t("coachTrainings.finalize.conflictsFirst")}</p>}

        <div>
          <Label htmlFor="led-by">{t("coachTrainings.ledBy.label")}</Label>
          <Select id="led-by" value={ledBy} onChange={(e) => setLedBy(e.target.value)} aria-describedby="led-by-hint">
            <option value="">{t("coachTrainings.ledBy.none")}</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <p id="led-by-hint" className="mt-1.5 text-xs text-text-muted">{t("coachTrainings.ledBy.hint")}</p>
        </div>

        {reported && (
          <section role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-3">
            <h3 className="font-medium text-text">{t("coachTrainings.finalize.reportedTitle")}</h3>
            <p className="mb-2 text-sm text-text-secondary">{t("coachTrainings.finalize.reportedBody")}</p>
            <ul className="mb-3 list-inside list-disc text-sm text-text">
              {reported.map((a) => <li key={a.athlete_id}>{a.first_name} {a.last_name}</li>)}
            </ul>
            <Button type="button" variant="danger" size="lg" onClick={() => submit(true)} loading={phase === "working"}>
              {t("coachTrainings.finalize.reportedConfirm")}
            </Button>
          </section>
        )}

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-text-muted">{t("coachTrainings.finalize.alertsNote")}</p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" size="lg" onClick={onClose}>{t("coachTrainings.finalize.back")}</Button>
          {!reported && (
            <Button type="button" size="lg" onClick={() => submit(false)} disabled={blocked || phase !== "ready"} loading={phase === "working"}>
              {phase === "working" ? t("coachTrainings.finalize.working") : t("coachTrainings.finalize.confirm")}
            </Button>
          )}
        </div>
      </div>
    </ModalDialog>
  );
}

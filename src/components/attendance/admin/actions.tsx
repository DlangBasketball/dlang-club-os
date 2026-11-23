"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, RefreshCw, RotateCw, X } from "lucide-react";
import { Button, Input, Label, Select, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import {
  acknowledgeAbsence, assignSessionCoach, decideSessionAccess, resolveCorrectionRequest,
} from "@/lib/actions/team-attendance";
import { refreshReviewFlags, resolveDataReviewFlag, retryNoShowAlert } from "@/lib/actions/admin-attendance";
import { FINAL_STATUSES, type FinalStatus } from "@/lib/attendance/types";

type AnyResult = { ok: true; message?: string } | { ok: false; error: string };

/** Run a server action, show its error / message, refresh the page on success. */
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const run = React.useCallback(async (fn: () => Promise<AnyResult>) => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else { setMessage(res.message ?? null); router.refresh(); }
      return res.ok;
    } finally {
      setBusy(false);
    }
  }, [router]);
  return { busy, error, message, run };
}

function Feedback({ error, message }: { error: string | null; message: string | null }) {
  if (error) return <FieldHint error>{error}</FieldHint>;
  if (message) return <FieldHint>{message}</FieldHint>;
  return null;
}

/** Assign a substitute / lead coach to one session (admin). */
export function AssignCoachForm({ eventId, coaches }: { eventId: string; coaches: { id: string; name: string }[] }) {
  const t = useT();
  const { busy, error, message, run } = useRun();
  const [coachId, setCoachId] = React.useState("");
  const [role, setRole] = React.useState<"substitute" | "lead">("substitute");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => { e.preventDefault(); if (coachId) void run(() => assignSessionCoach({ eventId, coachId, role })); }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_9rem]">
        <div>
          <Label htmlFor={`assign-${eventId}`}>{t("adminAttendance.session.assignCoach")}</Label>
          <Select id={`assign-${eventId}`} value={coachId} onChange={(e) => setCoachId(e.target.value)} disabled={busy}>
            <option value="">{t("adminAttendance.session.chooseCoach")}</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`assign-role-${eventId}`}>{t("adminAttendance.session.role")}</Label>
          <Select id={`assign-role-${eventId}`} value={role} onChange={(e) => setRole(e.target.value as "substitute" | "lead")} disabled={busy}>
            <option value="substitute">{t("adminAttendance.coverage.roleSubstitute")}</option>
            <option value="lead">{t("adminAttendance.coverage.roleLead")}</option>
          </Select>
        </div>
      </div>
      <Button type="submit" size="sm" disabled={busy || !coachId}>{t("adminAttendance.session.assign")}</Button>
      <Feedback error={error} message={message} />
    </form>
  );
}

/** Approve / reject a pending coach access request (or revoke an approved one). */
export function DecideAccessButtons({ assignmentId, status }: { assignmentId: string; status: string }) {
  const t = useT();
  const { busy, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex gap-1">
        {status !== "approved" && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => decideSessionAccess({ assignmentId, approve: true }))}>
            <Check className="h-3.5 w-3.5" aria-hidden /> {t("adminAttendance.access.approve")}
          </Button>
        )}
        {status !== "rejected" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => decideSessionAccess({ assignmentId, approve: false }))}>
            <X className="h-3.5 w-3.5" aria-hidden /> {status === "approved" ? t("adminAttendance.access.revoke") : t("adminAttendance.access.reject")}
          </Button>
        )}
      </span>
      <Feedback error={error} message={null} />
    </span>
  );
}

/** Accept (with a status) or reject (note required) a guardian's correction request. */
export function ResolveCorrectionForm({ requestId, requestedStatus }: { requestId: string; requestedStatus: string | null }) {
  const t = useT();
  const { busy, error, message, run } = useRun();
  const initial = (FINAL_STATUSES as readonly string[]).includes(requestedStatus ?? "") ? (requestedStatus as FinalStatus) : "excused";
  const [status, setStatus] = React.useState<FinalStatus>(initial);
  const [note, setNote] = React.useState("");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr]">
        <Select aria-label={t("adminAttendance.corrections.newStatus")} value={status} onChange={(e) => setStatus(e.target.value as FinalStatus)} disabled={busy}>
          {FINAL_STATUSES.map((s) => <option key={s} value={s}>{t.dynamic(`adminAttendance.mark.${s}`, undefined, s)}</option>)}
        </Select>
        <Input aria-label={t("adminAttendance.corrections.note")} placeholder={t("adminAttendance.corrections.notePlaceholder")} value={note}
          onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={busy} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void run(() => resolveCorrectionRequest({ requestId, accept: true, newStatus: status, note }))}>
          {t("adminAttendance.corrections.accept")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || !note.trim()} title={t("adminAttendance.corrections.rejectNeedsNote")}
          onClick={() => void run(() => resolveCorrectionRequest({ requestId, accept: false, note }))}>
          {t("adminAttendance.corrections.reject")}
        </Button>
      </div>
      <Feedback error={error} message={message} />
    </div>
  );
}

export function RetryAlertButton({ alertId, eventId }: { alertId: string; eventId?: string }) {
  const t = useT();
  const { busy, error, message, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => retryNoShowAlert(alertId, eventId))}>
        <RotateCw className="h-3.5 w-3.5" aria-hidden /> {t("adminAttendance.alerts.retry")}
      </Button>
      <Feedback error={error} message={message} />
    </span>
  );
}

export function AcknowledgeAbsenceButton({ reportId }: { reportId: string }) {
  const t = useT();
  const { busy, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => acknowledgeAbsence(reportId))}>
        <Check className="h-3.5 w-3.5" aria-hidden /> {t("adminAttendance.reports.acknowledge")}
      </Button>
      <Feedback error={error} message={null} />
    </span>
  );
}

export function ResolveFlagForm({ flagId }: { flagId: string }) {
  const t = useT();
  const { busy, error, message, run } = useRun();
  const [note, setNote] = React.useState("");
  return (
    <form className="flex flex-col items-stretch gap-1 sm:items-end" onSubmit={(e) => { e.preventDefault(); void run(() => resolveDataReviewFlag({ flagId, note })); }}>
      <span className="flex gap-1">
        <Input aria-label={t("adminAttendance.review.note")} placeholder={t("adminAttendance.review.notePlaceholder")} value={note}
          onChange={(e) => setNote(e.target.value)} maxLength={1000} className="h-9 w-full sm:w-48" disabled={busy} />
        <Button type="submit" size="sm" variant="secondary" disabled={busy}>{t("adminAttendance.review.resolve")}</Button>
      </span>
      <Feedback error={error} message={message} />
    </form>
  );
}

export function RefreshFlagsButton() {
  const t = useT();
  const { busy, error, message, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => refreshReviewFlags())}>
        <RefreshCw className="h-4 w-4" aria-hidden /> {t("adminAttendance.review.refresh")}
      </Button>
      <Feedback error={error} message={message} />
    </span>
  );
}

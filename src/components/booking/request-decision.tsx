"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button, FieldHint, Label } from "@/components/ui";
import { Textarea } from "@/components/teams/fields";
import { confirmBookingRequest, declineBookingRequest, withdrawBookingRequest } from "@/lib/actions/booking-workflow";
import { RequestIds } from "@/lib/booking/admin-form";
import { declineReasonOk } from "@/lib/booking/helpers";
import { useT } from "@/lib/i18n/client";

/**
 * Confirm / decline a booking request (session coach or admin). Decline needs
 * a reason (sent to the family). One request id per intent: a double click or
 * a retry replays instead of deciding twice.
 */
export function RequestDecision({ bookingId, compact = false }: { bookingId: string; compact?: boolean }) {
  const t = useT();
  const router = useRouter();
  const ids = React.useRef(new RequestIds()).current;
  const [declining, setDeclining] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const fieldId = React.useId();

  async function confirm() {
    setBusy(true); setMsg(null);
    const res = await confirmBookingRequest(bookingId, ids.get("confirm"));
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: res.error }); return; }
    ids.settle("confirm");
    setMsg({ tone: "ok", text: res.message ?? "" });
    router.refresh();
  }
  async function decline() {
    if (!declineReasonOk(reason)) { setMsg({ tone: "err", text: t("bookingWorkflow.errors.REASON_REQUIRED") }); return; }
    setBusy(true); setMsg(null);
    const res = await declineBookingRequest({ bookingId, reason }, ids.get("cancel"));
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: res.error }); return; }
    ids.settle("cancel");
    setDeclining(false); setReason("");
    setMsg({ tone: "ok", text: res.message ?? "" });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className={compact ? "flex flex-wrap gap-2" : "flex flex-wrap gap-2"}>
        <Button size="sm" disabled={busy} onClick={confirm}><Check className="h-4 w-4" aria-hidden /> {t("bookingRequests.confirm")}</Button>
        <Button size="sm" variant="secondary" disabled={busy} aria-expanded={declining} onClick={() => { setMsg(null); setDeclining((v) => !v); }}>
          <X className="h-4 w-4" aria-hidden /> {t("bookingRequests.decline")}
        </Button>
      </div>
      {declining && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Label htmlFor={fieldId}>{t("bookingRequests.declineReason")}</Label>
          <Textarea id={fieldId} maxLength={500} required value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          <FieldHint>{t("bookingRequests.declineHint")}</FieldHint>
          <Button size="sm" variant="danger" disabled={busy || !declineReasonOk(reason)} onClick={decline}>{t("bookingRequests.declineConfirm")}</Button>
        </div>
      )}
      {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
    </div>
  );
}

/** A guardian withdraws their own open request (before the coach decided). */
export function WithdrawRequestButton({ bookingId }: { bookingId: string }) {
  const t = useT();
  const router = useRouter();
  const ids = React.useRef(new RequestIds()).current;
  const [busy, setBusy] = React.useState(false);
  const [sure, setSure] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function run() {
    setBusy(true); setErr(null);
    const res = await withdrawBookingRequest(bookingId, ids.get("cancel"));
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    ids.settle("cancel");
    router.refresh();
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {sure ? (
        <>
          <Button size="sm" variant="danger" disabled={busy} onClick={run}>{t("bookingRequests.withdrawConfirm")}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSure(false)}>{t("common.cancel")}</Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setSure(true)}>{t("bookingRequests.withdraw")}</Button>
      )}
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}

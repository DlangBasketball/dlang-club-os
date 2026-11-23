"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button, Label, Textarea } from "@/components/ui";
import { decideCampApproval } from "@/lib/actions/camp-approval";
import { useT } from "@/lib/i18n/client";

function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Approve / decline one request. The request id is fixed per decision, so a
 * double click or a retry after a network error returns the first decision.
 */
export function ApprovalDecision({ registrationId }: { registrationId: string }) {
  const t = useT();
  const router = useRouter();
  const ids = React.useRef<{ approve: string; decline: string }>({ approve: newRequestId(), decline: newRequestId() });
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"approve" | "decline" | null>(null);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  async function decide(decision: "approve" | "decline") {
    if (busy) return;
    setBusy(decision); setMsg(null);
    const res = await decideCampApproval({ registrationId, decision, note, requestId: ids.current[decision] });
    setBusy(null);
    if (!res.ok) { setMsg({ tone: "err", text: res.error }); return; }
    if (res.outcome === "full") {
      // Nothing changed: a later attempt is a new decision.
      ids.current.approve = newRequestId();
      setMsg({ tone: "warn", text: res.message ?? "" });
      return;
    }
    setMsg({ tone: "ok", text: t.dynamic(`camps.approval.admin.done.${res.outcome}`) });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`note-${registrationId}`}>{t("camps.approval.admin.note")}</Label>
      <Textarea id={`note-${registrationId}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="success" disabled={busy !== null} onClick={() => decide("approve")}>
          <Check className="h-4 w-4" aria-hidden /> {busy === "approve" ? t("common.saving") : t("camps.approval.admin.approve")}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => decide("decline")}>
          <X className="h-4 w-4" aria-hidden /> {busy === "decline" ? t("common.saving") : t("camps.approval.admin.decline")}
        </Button>
      </div>
      {msg && (
        <p role="status" className={`text-xs ${msg.tone === "ok" ? "text-success" : msg.tone === "warn" ? "text-warning" : "text-danger"}`}>{msg.text}</p>
      )}
    </div>
  );
}

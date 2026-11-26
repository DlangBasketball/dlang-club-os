"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, MessageCircleQuestion, X } from "lucide-react";
import { Button, Label, Textarea } from "@/components/ui";
import { decideClubRequest } from "@/lib/actions/club-approval";
import { useT } from "@/lib/i18n/client";

type Decision = "approve" | "request_info" | "decline";

/**
 * Approve / request more information / decline one club request. The request
 * id is fixed per decision, so a double click or a retry after a network error
 * returns the first decision (the RPC replays it).
 */
export function ClubRequestDecision({ requestId, childName, canRequestInfo }: { requestId: string; childName: string; canRequestInfo: boolean }) {
  const t = useT();
  const router = useRouter();
  const ids = React.useRef<Record<Decision, string>>({
    approve: crypto.randomUUID(), request_info: crypto.randomUUID(), decline: crypto.randomUUID(),
  });
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState<Decision | null>(null);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const inFlight = React.useRef(false);
  const [decided, setDecided] = React.useState(false);

  async function decide(decision: Decision) {
    if (inFlight.current || decided) return;
    if (decision === "request_info" && !message.trim()) {
      setMsg({ tone: "err", text: t("approvals.errors.MESSAGE_REQUIRED") });
      return;
    }
    inFlight.current = true;
    setBusy(decision); setMsg(null);
    try {
      const res = await decideClubRequest({ id: requestId, decision, message, requestId: ids.current[decision] });
      if (!res.ok) { setMsg({ tone: "err", text: res.error }); return; }
      if (res.data?.outcome === "full") {
        // Nothing changed: a later attempt is a new decision.
        ids.current.approve = crypto.randomUUID();
        setMsg({ tone: "warn", text: t("approvals.reviewer.forChild", { name: childName, message: res.message ?? "" }) });
        return;
      }
      setDecided(true);
      setMsg({ tone: "ok", text: t("approvals.reviewer.forChild", { name: childName, message: res.message ?? "" }) });
      router.refresh();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const disabled = busy !== null || decided;
  return (
    <div className="space-y-2">
      <Label htmlFor={`msg-${requestId}`}>{t("approvals.reviewer.message")}</Label>
      <Textarea id={`msg-${requestId}`} rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
      <p className="text-xs text-text-muted">{t("approvals.reviewer.messageHint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="success" disabled={disabled} onClick={() => decide("approve")}>
          <Check className="h-4 w-4" aria-hidden /> {busy === "approve" ? t("common.saving") : t("approvals.reviewer.confirm")}
        </Button>
        {canRequestInfo && (
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => decide("request_info")}>
            <MessageCircleQuestion className="h-4 w-4" aria-hidden /> {busy === "request_info" ? t("common.saving") : t("approvals.reviewer.requestInfo")}
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => decide("decline")}>
          <X className="h-4 w-4" aria-hidden /> {busy === "decline" ? t("common.saving") : t("approvals.reviewer.decline")}
        </Button>
      </div>
      {msg && (
        <p role="status" className={`text-xs ${msg.tone === "ok" ? "text-success" : msg.tone === "warn" ? "text-warning" : "text-danger"}`}>{msg.text}</p>
      )}
    </div>
  );
}

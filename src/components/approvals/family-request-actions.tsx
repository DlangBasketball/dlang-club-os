"use client";
import * as React from "react";
import { Button, Label, Textarea } from "@/components/ui";
import { useCaAction } from "@/components/club-admin/use-ca-action";
import { replyClubRequest, withdrawClubRequest } from "@/lib/actions/club-approval";
import { useT } from "@/lib/i18n/client";

/** Family: answer the club's question (when asked) and withdraw an open request. Request ids make retries safe. */
export function FamilyRequestActions({ id, canReply, canWithdraw }: { id: string; canReply: boolean; canWithdraw: boolean }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [text, setText] = React.useState("");
  const replyId = React.useRef(crypto.randomUUID());
  const withdrawId = React.useRef(crypto.randomUUID());
  if (!canReply && !canWithdraw) return null;
  return (
    <div className="space-y-2">
      {canReply && (
        <>
          <Label htmlFor={`reply-${id}`}>{t("approvals.family.replyLabel")}</Label>
          <Textarea id={`reply-${id}`} rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canReply && (
          <Button size="sm" loading={busy} disabled={!text.trim()}
            onClick={() => run(() => replyClubRequest({ id, message: text, requestId: replyId.current }), () => { setText(""); replyId.current = crypto.randomUUID(); })}>
            {t("approvals.family.sendReply")}
          </Button>
        )}
        {canWithdraw && (
          <Button size="sm" variant="ghost" loading={busy}
            onClick={() => { if (window.confirm(t("approvals.family.withdrawConfirm"))) void run(() => withdrawClubRequest({ id, requestId: withdrawId.current })); }}>
            {t("approvals.family.withdraw")}
          </Button>
        )}
        {note}
      </div>
    </div>
  );
}

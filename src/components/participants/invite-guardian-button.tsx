"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { inviteGuardianForFlag } from "@/lib/actions/guardian-invite-flag";

/** "Invite a guardian" on a NO_GUARDIAN_LOGIN suggestion (family contact e-mail, existing invitation flow). */
export function InviteGuardianButton({ flagId, invitedAt }: { flagId: string; invitedAt: string | null }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col items-stretch gap-1 sm:items-end">
      <Button type="button" size="sm" loading={busy} disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        const res = await inviteGuardianForFlag(flagId);
        setBusy(false);
        setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
        if (res.ok) router.refresh();
      }}>
        {invitedAt ? t("adminAttendance.review.invite.resend") : t("adminAttendance.review.invite.button")}
      </Button>
      {msg && <span role="status" className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>}
    </span>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { acceptRelativeInvite } from "@/lib/actions/relative-invites";

/** Accept as the signed-in invitee (the e-mail check happens in the database). */
export function AcceptInvite({ token, signedInAs }: { token: string; signedInAs: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function accept() {
    setBusy(true); setMsg(null);
    const res = await acceptRelativeInvite(token);
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? "" : res.error });
    if (res.ok) {
      router.push(res.data.athleteId ? `/parent/children/${res.data.athleteId}` : "/parent/athletes");
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">{t("participants.invite.page.signedInAs", { email: signedInAs })}</p>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      <Button type="button" onClick={() => void accept()} loading={busy}>{t("participants.invite.page.accept")}</Button>
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { revokeConsentRequest } from "@/lib/actions/public-entry";

/** The booker withdraws a booking still awaiting the guardian's consent (frees the place). */
export function WithdrawRequest({ requestId }: { requestId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function go() {
    if (!window.confirm(t("consentRequest.others.withdrawConfirm"))) return;
    setBusy(true); setErr(null);
    const res = await revokeConsentRequest(requestId);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="ghost" loading={busy} onClick={() => void go()}>{t("consentRequest.others.withdraw")}</Button>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </div>
  );
}

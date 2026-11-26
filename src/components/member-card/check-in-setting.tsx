"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { updateCardCheckIn } from "@/lib/actions/settings";

/** Club decision (default OFF): use the member cards for QR / NFC check-in at training. */
export function CardCheckInSettingForm({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [on, setOn] = React.useState(enabled);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await updateCardCheckIn(on);
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? t("memberCard.checkInSetting.saved") : res.error });
    if (res.ok) router.refresh();
  }
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>{t("memberCard.checkInSetting.title")}</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-3" onSubmit={(e) => void save(e)}>
          <label className="flex items-start gap-2 text-sm text-text">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" checked={on} disabled={!canEdit}
              onChange={(e) => setOn(e.target.checked)} />
            <span>{t("memberCard.checkInSetting.label")}</span>
          </label>
          <ul className="list-disc space-y-1 pl-5 text-xs text-text-muted">
            <li>{t("memberCard.checkInSetting.hintOff")}</li>
            <li>{t("memberCard.checkInSetting.hintOn")}</li>
          </ul>
          {canEdit && (
            <div className="flex items-center gap-3">
              <Button type="submit" loading={busy} disabled={busy}>{t("memberCard.checkInSetting.save")}</Button>
              {msg && <span role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
            </div>
          )}
        </form>
      </CardBody>
    </Card>
  );
}

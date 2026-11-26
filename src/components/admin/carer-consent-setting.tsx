"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { updateCarerConsent } from "@/lib/actions/settings";

/**
 * Club setting (default OFF): relatives linked to one child may accept the
 * activity consents of their own bookings when the family gave them that
 * permission. Health declarations still need the family unless the relative
 * may see medical information; COPPA consent always stays with the family.
 */
export function CarerConsentSettingForm({ enabled }: { enabled: boolean }) {
  const t = useT();
  const router = useRouter();
  const [on, setOn] = React.useState(enabled);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await updateCarerConsent(on);
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? t("participants.carerConsent.setting.saved") : res.error });
    if (res.ok) router.refresh();
  }
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>{t("participants.carerConsent.setting.title")}</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-3" onSubmit={(e) => void save(e)}>
          <label className="flex items-start gap-2 text-sm text-text">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" checked={on} onChange={(e) => setOn(e.target.checked)} />
            <span>{t("participants.carerConsent.setting.label")}</span>
          </label>
          <ul className="list-disc space-y-1 pl-5 text-xs text-text-muted">
            <li>{t("participants.carerConsent.setting.hintPermission")}</li>
            <li>{t("participants.carerConsent.setting.hintHealth")}</li>
            <li>{t("participants.carerConsent.setting.hintOff")}</li>
          </ul>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={busy} disabled={busy}>{t("participants.carerConsent.setting.save")}</Button>
            {msg && <span role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

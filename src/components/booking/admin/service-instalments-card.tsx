"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, FieldHint, Label } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import { saveServiceInstalments } from "@/lib/actions/booking-orders";
import { SERVICE_MAX_INSTALMENTS } from "@/lib/booking/instalments";
import { useT } from "@/lib/i18n/client";

/**
 * Services -> service page "Instalments allowed: up to N" (admin + finance).
 * 1 = pay in full only. Bookings already made keep their terms; the choice
 * is offered on new staff bookings and family requests of this service.
 */
export function ServiceInstalmentsCard({ serviceId, initial, canEdit }: { serviceId: string; initial: number; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [max, setMax] = React.useState(Math.min(Math.max(initial || 1, 1), SERVICE_MAX_INSTALMENTS));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const label = (n: number) => (n === 1 ? t("serviceInstalments.editor.payInFullOnly") : t("serviceInstalments.editor.upTo", { count: n }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await saveServiceInstalments(serviceId, max);
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? "" : res.error });
    if (res.ok) router.refresh();
  }

  if (!canEdit) return <p className="text-sm text-ink-2">{label(max)}</p>;
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="max-w-xs">
        <Label htmlFor="svc-inst-max">{t("serviceInstalments.editor.label")}</Label>
        <Select id="svc-inst-max" value={String(max)} disabled={busy} onChange={(e) => { setMsg(null); setMax(Number(e.target.value)); }}>
          {Array.from({ length: SERVICE_MAX_INSTALMENTS }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{label(n)}</option>)}
        </Select>
        <FieldHint>{t("serviceInstalments.editor.hint")}</FieldHint>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || max === initial}>{busy ? t("serviceInstalments.editor.saving") : t("serviceInstalments.editor.save")}</Button>
        {msg && <span role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
      </div>
    </form>
  );
}

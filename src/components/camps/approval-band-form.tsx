"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldQuestion } from "lucide-react";
import { Button, Card, CardBody, Input, Label } from "@/components/ui";
import { saveCampApprovalBand } from "@/lib/actions/camp-approval";
import { validateApprovalBand } from "@/lib/camps/age-approval";
import { useT } from "@/lib/i18n/client";

/** Admin camp settings: the age approval band (default off). */
export function ApprovalBandForm({ programId, minAge, initialMin, initialMax }: {
  programId: string; minAge: number | null; initialMin: number | null; initialMax: number | null;
}) {
  const t = useT();
  const router = useRouter();
  const [min, setMin] = React.useState(initialMin === null ? "" : String(initialMin));
  const [max, setMax] = React.useState(initialMax === null ? "" : String(initialMax));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const enabled = initialMin !== null && initialMax !== null;

  async function save(nextMin: number | null, nextMax: number | null) {
    const local = validateApprovalBand(nextMin, nextMax, minAge);
    if (local) { setMsg({ ok: false, text: t.dynamic(local) }); return; }
    setBusy(true); setMsg(null);
    const res = await saveCampApprovalBand(programId, { min: nextMin, max: nextMax });
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
    setMsg({ ok: true, text: t("common.saved") });
    router.refresh();
  }

  return (
    <Card><CardBody className="space-y-3">
      <div className="flex items-center gap-2 font-medium text-ink"><ShieldQuestion className="h-4 w-4" aria-hidden />{t("camps.approval.settings.title")}</div>
      <p className="text-sm text-ink-2">{t("camps.approval.settings.description")}</p>
      <p className="text-xs text-ink-3">
        {enabled ? t("camps.approval.settings.current", { min: initialMin!, max: initialMax! }) : t("camps.approval.settings.off")}
      </p>
      {minAge === null ? <p className="text-xs text-warning">{t("camps.approval.errors.needsMinAge")}</p> : (
        <>
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <div><Label htmlFor={`ab-min-${programId}`}>{t("camps.approval.settings.min")}</Label>
              <Input id={`ab-min-${programId}`} type="number" inputMode="numeric" min={0} max={99} value={min} onChange={(e) => setMin(e.target.value)} /></div>
            <div><Label htmlFor={`ab-max-${programId}`}>{t("camps.approval.settings.max")}</Label>
              <Input id={`ab-max-${programId}`} type="number" inputMode="numeric" min={0} max={99} value={max} onChange={(e) => setMax(e.target.value)} /></div>
          </div>
          <p className="text-xs text-ink-3">{t("camps.approval.settings.hint", { minAge })}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => save(num(min), num(max))} disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
            {enabled && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMin(""); setMax(""); void save(null, null); }}>{t("camps.approval.settings.turnOff")}</Button>}
          </div>
        </>
      )}
      {msg && <p role="status" className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
    </CardBody></Card>
  );
}

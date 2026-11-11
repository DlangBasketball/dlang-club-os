"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { updateBookingSettings } from "@/lib/actions/booking";

export function BookingSettingsForm({ enabled, cancellationHours, refundCreditsOnCancel }: { enabled: boolean; cancellationHours: number; refundCreditsOnCancel: boolean }) {
  const router = useRouter();
  const [f, setF] = React.useState({ enabled, cancellationHours, refundCreditsOnCancel });
  const [msg, setMsg] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  async function save() {
    setPending(true); setMsg(null);
    const res = await updateBookingSettings(f); setPending(false);
    if (res.ok) { setMsg("Saved"); router.refresh(); } else setMsg(res.error);
  }
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" /> Parents can book online</label>
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={f.refundCreditsOnCancel} onChange={(e) => setF({ ...f, refundCreditsOnCancel: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" /> Refund credits on in-policy cancellation</label>
      <div className="flex items-end gap-2">
        <div><label className="text-xs text-ink-3">Free cancellation window (hours)</label><Input type="number" value={f.cancellationHours} onChange={(e) => setF({ ...f, cancellationHours: Number(e.target.value) })} className="w-32" /></div>
        <Button size="sm" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
        {msg && <span className="pb-2 text-sm text-success">{msg}</span>}
      </div>
    </div>
  );
}

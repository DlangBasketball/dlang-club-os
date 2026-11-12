"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { cancelBookingAction, rescheduleBookingAction } from "@/lib/actions/booking";
import { useFormat } from "@/lib/i18n/client";

type Slot = { id: string; coachName: string; start: string };
export function BookingActions({ bookingId, status, cancellationHours, slotStart, rescheduleSlots }: {
  bookingId: string; status: string; cancellationHours: number; slotStart: string; rescheduleSlots: Slot[];
}) {
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [show, setShow] = React.useState(false);

  if (status !== "booked") return null;
  const hoursUntil = (new Date(slotStart).getTime() - Date.now()) / 36e5;
  const within = hoursUntil >= cancellationHours;

  async function doCancel() {
    if (!window.confirm(within ? "Cancel this booking? Any credits will be refunded." : `This is within ${cancellationHours}h of the session — credits won't be refunded. Cancel anyway?`)) return;
    setBusy(true); setErr(null);
    const res = await cancelBookingAction(bookingId);
    setBusy(false);
    if (res.ok) router.refresh(); else setErr(res.error);
  }
  async function doReschedule(slotId: string) {
    setBusy(true); setErr(null);
    const res = await rescheduleBookingAction(bookingId, slotId);
    setBusy(false);
    if (res.ok) { setShow(false); router.refresh(); } else setErr(res.error);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setShow((s) => !s)}>Reschedule</Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={doCancel}>Cancel booking</Button>
      </div>
      {!within && <p className="text-xs text-warning">Within {cancellationHours}h of the session — cancellation won&apos;t refund credits.</p>}
      {err && <p className="text-sm text-danger">{err}</p>}
      {show && (
        <div className="rounded-lg border border-line p-3">
          <p className="mb-2 text-xs text-ink-3">Pick a new slot:</p>
          {rescheduleSlots.length === 0 ? <p className="text-sm text-ink-3">No other slots available.</p> : (
            <div className="space-y-1">
              {rescheduleSlots.map((s) => (
                <button key={s.id} disabled={busy} onClick={() => doReschedule(s.id)} className="flex w-full items-center justify-between rounded border border-line px-3 py-2 text-left text-sm hover:border-maroon/40 disabled:opacity-50">
                  <span className="text-ink">{f.date(s.start)} · {f.time(s.start)}</span><span className="text-xs text-ink-3">{s.coachName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

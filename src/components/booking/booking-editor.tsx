"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { Select, Textarea } from "@/components/teams/fields";
import { ReasonDialog } from "@/components/club-ops/reason-dialog";
import { adminCancelBooking, adminUpdateBooking } from "@/lib/actions/booking";
import { BOOKING_EDIT_STATUSES, zonedParts } from "@/lib/club-ops/validation";
import { zonedWallTimeToUtc } from "@/lib/format";
import { useFormat, useT } from "@/lib/i18n/client";

type Opt = { id: string; name: string };
type Status = (typeof BOOKING_EDIT_STATUSES)[number];

/** Admin: edit a booking (service, coach, date/time, status, notes) or cancel it with a reason. */
export function BookingEditor({ bookingId, status, serviceId, coachId, start, end, notes, services, coaches }: {
  bookingId: string; status: string; serviceId: string; coachId: string; start: string; end: string | null; notes: string | null;
  services: (Opt & { durationMin: number })[]; coaches: Opt[];
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const s0 = zonedParts(start, f.timeZone);
  const e0 = zonedParts(end, f.timeZone);
  const [v, setV] = React.useState({
    serviceId, coachId, date: s0.date, from: s0.time, to: e0.time,
    status: (BOOKING_EDIT_STATUSES as readonly string[]).includes(status) ? (status as Status) : "booked", notes: notes ?? "",
  });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelErr, setCancelErr] = React.useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => { setMsg(null); setV((s) => ({ ...s, [k]: val })); };

  if (status === "cancelled") return null;

  function onService(id: string) {
    // Keep the end in step with the new service's duration.
    const svc = services.find((x) => x.id === id);
    setV((s) => {
      const st = zonedWallTimeToUtc(s.date, s.from, f.timeZone);
      const to = st && svc ? zonedParts(new Date(st.getTime() + svc.durationMin * 60000).toISOString(), f.timeZone).time : s.to;
      return { ...s, serviceId: id, to };
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const st = zonedWallTimeToUtc(v.date, v.from, f.timeZone);
    const en = v.to ? zonedWallTimeToUtc(v.date, v.to, f.timeZone) : null;
    if (!st) { setMsg({ tone: "err", text: t("editOps.errors.invalidDate") }); return; }
    const moved = st.toISOString() !== new Date(start).toISOString() || v.coachId !== coachId;
    if (moved && !window.confirm(t("editOps.bookings.confirmMove"))) return;
    setBusy(true); setMsg(null);
    const res = await adminUpdateBooking(bookingId, {
      serviceId: v.serviceId, coachId: v.coachId, startsAt: st.toISOString(), endsAt: en ? en.toISOString() : "", status: v.status, notes: v.notes,
    });
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: res.error }); return; }
    setMsg({ tone: "ok", text: t("common.saved") });
    router.refresh();
  }
  async function cancel(reason: string) {
    setBusy(true); setCancelErr(null);
    const res = await adminCancelBooking(bookingId, reason);
    setBusy(false);
    if (!res.ok) { setCancelErr(res.error); return; }
    setCancelOpen(false);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor="b-svc">{t("editOps.bookings.service")}</Label>
          <Select id="b-svc" value={v.serviceId} disabled={busy} onChange={(e) => onService(e.target.value)}>
            {services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor="b-coach">{t("editOps.bookings.coach")}</Label>
          <Select id="b-coach" value={v.coachId} disabled={busy} onChange={(e) => set("coachId", e.target.value)}>
            {coaches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor="b-date">{t("common.date")}</Label><Input id="b-date" type="date" required value={v.date} disabled={busy} onChange={(e) => set("date", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor="b-from">{t("editOps.bookings.from")}</Label><Input id="b-from" type="time" required step={300} value={v.from} disabled={busy} onChange={(e) => set("from", e.target.value)} /></div>
          <div><Label htmlFor="b-to">{t("editOps.bookings.to")}</Label><Input id="b-to" type="time" step={300} value={v.to} disabled={busy} onChange={(e) => set("to", e.target.value)} /></div>
        </div>
        <div><Label htmlFor="b-status">{t("common.status")}</Label>
          <Select id="b-status" value={v.status} disabled={busy} onChange={(e) => set("status", e.target.value as Status)}>
            {BOOKING_EDIT_STATUSES.map((s) => <option key={s} value={s}>{t(`editOps.bookings.statuses.${s}`)}</option>)}
          </Select></div>
      </div>
      <div><Label htmlFor="b-notes">{t("common.notes")}</Label><Textarea id="b-notes" maxLength={2000} value={v.notes} disabled={busy} onChange={(e) => set("notes", e.target.value)} /></div>
      <p className="text-xs text-ink-3">{t("editOps.bookings.paymentHint")}</p>
      {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
        <Button type="button" variant="danger" disabled={busy} onClick={() => { setCancelErr(null); setCancelOpen(true); }}><XCircle className="h-4 w-4" /> {t("editOps.bookings.cancelBooking")}</Button>
      </div>
      <ReasonDialog open={cancelOpen} required title={t("editOps.bookings.cancelTitle")} description={t("editOps.bookings.cancelDescription")}
        confirmLabel={t("editOps.bookings.cancelConfirm")} pending={busy} error={cancelErr}
        onClose={() => setCancelOpen(false)} onConfirm={cancel} />
    </form>
  );
}

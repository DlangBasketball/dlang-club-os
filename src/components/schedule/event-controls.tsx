"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, HelpCircle, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { FormError, Select } from "@/components/teams/fields";
import { deleteEvent, recordResult, setEventStatus, setRsvp } from "@/lib/sportsops/actions";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { ReasonDialog, ScopeChoice } from "@/components/club-ops/reason-dialog";

type Rsvp = "going" | "maybe" | "not_going";

export function RsvpButtons({ eventId, athleteId, current, label, compact }: { eventId: string; athleteId: string; current: Rsvp | null; label?: string; compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState<Rsvp | null>(current);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function pick(s: Rsvp) {
    const prev = value;
    setValue(s); setBusy(true); setErr(null);
    const res = await setRsvp(eventId, athleteId, s);
    setBusy(false);
    if (!res.ok) { setValue(prev); setErr(res.error); } else router.refresh();
  }
  const opts: { v: Rsvp; icon: React.ReactNode; text: string; on: string }[] = [
    { v: "going", icon: <Check className="h-3.5 w-3.5" />, text: "Going", on: "bg-success-soft text-success border-success" },
    { v: "maybe", icon: <HelpCircle className="h-3.5 w-3.5" />, text: "Maybe", on: "bg-warning-soft text-warning border-warning" },
    { v: "not_going", icon: <X className="h-3.5 w-3.5" />, text: "Can't", on: "bg-danger-soft text-danger border-danger" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="min-w-[4rem] text-sm text-ink-2">{label}</span>}
      <div role="group" aria-label={`Availability${label ? ` for ${label}` : ""}`} className="flex gap-1">
        {opts.map((o) => (
          <button key={o.v} type="button" disabled={busy} aria-pressed={value === o.v} onClick={() => pick(o.v)}
            className={cn("inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:text-ink disabled:opacity-60",
              value === o.v && o.on)}>
            {o.icon}{!compact && o.text}
          </button>
        ))}
      </div>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}

export function ResultForm({ eventId, scoreFor, scoreAgainst, notes }: { eventId: string; scoreFor?: number; scoreAgainst?: number; notes?: string | null }) {
  const router = useRouter();
  const [a, setA] = React.useState(scoreFor?.toString() ?? "");
  const [b, setB] = React.useState(scoreAgainst?.toString() ?? "");
  const [n, setN] = React.useState(notes ?? "");
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (a === "" || b === "") return setErr("Enter both scores.");
    setBusy(true); setErr(null);
    const res = await recordResult(eventId, Number(a), Number(b), n);
    setBusy(false);
    if (!res.ok) setErr(res.error); else router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-end gap-2">
        <div><Label htmlFor="r-for">Us</Label><Input id="r-for" className="w-20 text-center tnum" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, "").slice(0, 5))} /></div>
        <span className="pb-2 text-ink-3">–</span>
        <div><Label htmlFor="r-ag">Them</Label><Input id="r-ag" className="w-20 text-center tnum" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, "").slice(0, 5))} /></div>
      </div>
      <div><Label htmlFor="r-notes">Notes</Label><Input id="r-notes" maxLength={500} value={n} onChange={(e) => setN(e.target.value)} placeholder="Optional" /></div>
      <FormError message={err} />
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save result"}</Button>
    </form>
  );
}

type EventStatusValue = "scheduled" | "postponed" | "cancelled" | "completed";

export function EventStatusControl({ eventId, status, seriesId, canDelete, afterDelete }: {
  eventId: string; status: string; seriesId?: string | null; canDelete?: boolean; afterDelete?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | "cancel" | "delete">(null);
  const [scope, setScope] = React.useState<"one" | "following">("one");
  const inSeries = !!seriesId;

  async function change(s: EventStatusValue, reason?: string) {
    setBusy(true); setErr(null);
    const res = await setEventStatus(eventId, s, { reason, scope });
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setDialog(null); setScope("one");
    router.refresh();
  }
  function onSelect(s: string) {
    if (s === status) return;
    if (s === "cancelled") { setScope("one"); setErr(null); setDialog("cancel"); return; }
    void change(s as EventStatusValue);
  }
  async function remove() {
    setBusy(true); setErr(null);
    const res = await deleteEvent(eventId, scope);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setDialog(null);
    router.push(afterDelete ?? "/admin/schedule");
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={t("common.status")} className="h-8 w-40" value={status} disabled={busy} onChange={(e) => onSelect(e.target.value)}>
        {(["scheduled", "postponed", "cancelled", "completed"] as const).map((s) => <option key={s} value={s}>{t(`editOps.events.statuses.${s}`)}</option>)}
      </Select>
      {status !== "cancelled" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSelect("cancelled")}>{t("editOps.events.cancelEvent")}</Button>}
      {canDelete && <Button size="sm" variant="ghost" onClick={() => { setScope("one"); setErr(null); setDialog("delete"); }} disabled={busy}>{t("common.delete")}</Button>}
      {err && !dialog && <span role="alert" className="text-xs text-danger">{err}</span>}

      <ReasonDialog open={dialog === "cancel"} title={t("editOps.events.cancelTitle")} description={t("editOps.events.cancelDescription")}
        confirmLabel={t("editOps.events.cancelConfirm")} pending={busy} error={err}
        onClose={() => setDialog(null)} onConfirm={(reason) => change("cancelled", reason)}>
        {inSeries && <ScopeChoice value={scope} onChange={setScope} />}
      </ReasonDialog>

      {dialog === "delete" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => !busy && setDialog(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md space-y-3 rounded-t-2xl border border-line bg-surface-card p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-ink">{t("editOps.events.deleteTitle")}</h3>
            <p className="text-sm text-ink-2">{t("editOps.events.deleteConfirm")}</p>
            {inSeries && <ScopeChoice value={scope} onChange={setScope} />}
            {err && <p role="alert" className="text-sm text-danger">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{t("common.cancel")}</Button>
              <Button variant="danger" disabled={busy} onClick={remove}>{busy ? t("common.saving") : t("common.delete")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

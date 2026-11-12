"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { Select, Textarea } from "@/components/teams/fields";
import {
  cancelTrainingGroup, cancelTrainingPurchase, cancelTrainingSession, confirmTrainingGroup, markTrainingSession, purchaseTrainingPackage,
  rescheduleTrainingSession, saveTrainingProfile,
} from "@/lib/actions/training";
import { useFormat, useT } from "@/lib/i18n/client";
import { sortPackages } from "@/lib/training/pricing";
import { isWithinCancellationWindow } from "@/lib/training/pricing";
import type { Slot } from "@/lib/training/slots";
import type { TrainingService, TrainingWizardData } from "@/lib/training/data";
import { ANY_COACH, SlotPicker, slotsFor } from "./slot-picker";

function useAction() {
  const router = useRouter();
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setBusy(true); setErr(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? null); return false; }
    after?.();
    router.refresh();
    return true;
  }
  return { err, busy, run };
}

/** Admin: sell or grant a package (or a single session credit) to an athlete. */
export function SellPackageForm({ athletes, services }: { athletes: { id: string; name: string }[]; services: TrainingService[] }) {
  const t = useT();
  const f = useFormat();
  const { err, busy, run } = useAction();
  const [athleteId, setAthleteId] = React.useState("");
  const [serviceId, setServiceId] = React.useState(services[0]?.id ?? "");
  const [packageId, setPackageId] = React.useState("");
  const [mode, setMode] = React.useState<"invoice" | "paid" | "comp">("invoice");
  const [note, setNote] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const service = services.find((s) => s.id === serviceId);
  const packages = service ? sortPackages(service.packages) : [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label htmlFor="sp-ath">{t("training.book.athlete")}</Label>
          <Select id="sp-ath" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
            <option value="">—</option>
            {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select></div>
        <div><Label htmlFor="sp-svc">{t("training.book.stepService")}</Label>
          <Select id="sp-svc" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setPackageId(""); }}>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select></div>
        <div><Label htmlFor="sp-pkg">{t("training.sell.package")}</Label>
          <Select id="sp-pkg" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">{service ? `${t("training.book.single")} · ${f.money(service.price, service.currency ?? undefined)}` : "—"}</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{(p.name || t("training.packages.defaultName", { count: p.sessions }))} · {f.money(p.price, service?.currency ?? undefined)}</option>)}
          </Select></div>
        <div><Label htmlFor="sp-mode">{t("training.sell.mode")}</Label>
          <Select id="sp-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="invoice">{t("training.sell.modes.invoice")}</option>
            <option value="paid">{t("training.sell.modes.paid")}</option>
            <option value="comp">{t("training.sell.modes.comp")}</option>
          </Select></div>
      </div>
      <div><Label htmlFor="sp-note">{t("training.sell.note")}</Label><Input id="sp-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !athleteId || !serviceId} onClick={() => { setMsg(null); run(() => purchaseTrainingPackage({ athleteId, serviceId, packageId: packageId || null, mode, note }), () => { setMsg(t("training.sell.done")); setNote(""); }); }}>
          {busy ? t("common.saving") : t("training.sell.submit")}
        </Button>
        {msg && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/** Cancel a purchase with a reason (unpaid invoice cancelled with it). */
export function CancelPurchaseButton({ purchaseId }: { purchaseId: string }) {
  const t = useT();
  const { err, busy, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
        const reason = window.prompt(t("training.purchases.cancelPrompt"));
        if (reason && reason.trim()) run(() => cancelTrainingPurchase(purchaseId, reason));
      }}>{t("training.purchases.cancel")}</Button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}

/** Group slot below its minimum: confirm anyway or cancel everyone. */
export function GroupSlotActions({ coachId, serviceId, start, confirmed }: { coachId: string; serviceId: string; start: string; confirmed: boolean }) {
  const t = useT();
  const { err, busy, run } = useAction();
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {!confirmed && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => confirmTrainingGroup(coachId, serviceId, start))}>{t("training.groups.confirm")}</Button>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
        const reason = window.prompt(t("training.groups.cancelPrompt"));
        if (reason && reason.trim()) run(() => cancelTrainingGroup(coachId, serviceId, start, reason));
      }}>{t("training.groups.cancel")}</Button>
      {err && <span role="alert" className="w-full text-right text-xs text-danger">{err}</span>}
    </span>
  );
}

/** Coach / admin: attended or no-show. */
export function MarkSessionButtons({ bookingId, status }: { bookingId: string; status: string }) {
  const t = useT();
  const { err, busy, run } = useAction();
  if (status === "cancelled") return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status !== "completed" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => markTrainingSession(bookingId, "completed"))}>{t("training.profile.markAttended")}</Button>}
      {status !== "no_show" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => markTrainingSession(bookingId, "no_show"))}>{t("training.profile.markNoShow")}</Button>}
      {status !== "booked" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => markTrainingSession(bookingId, "booked"))}>{t("training.profile.markBooked")}</Button>}
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}

/** Goals / notes / level / focus areas; read-only for parents. */
export function TrainingProfileEditor({ athleteId, profile, canEdit }: {
  athleteId: string; profile: { goals: string; notes: string; level: string; focusAreas: string[] }; canEdit: boolean;
}) {
  const t = useT();
  const { err, busy, run } = useAction();
  const [f, setF] = React.useState({ ...profile, focus: profile.focusAreas.join(", ") });
  const [msg, setMsg] = React.useState<string | null>(null);
  if (!canEdit) {
    return (
      <dl className="space-y-3 text-sm">
        <div><dt className="text-xs uppercase tracking-wide text-ink-4">{t("training.profile.goals")}</dt><dd className="whitespace-pre-line text-ink">{profile.goals || "—"}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-ink-4">{t("training.profile.notes")}</dt><dd className="whitespace-pre-line text-ink">{profile.notes || "—"}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-ink-4">{t("training.profile.level")}</dt><dd className="text-ink">{profile.level || "—"}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-ink-4">{t("training.profile.focus")}</dt><dd className="text-ink">{profile.focusAreas.join(", ") || "—"}</dd></div>
      </dl>
    );
  }
  return (
    <div className="space-y-3">
      <div><Label htmlFor="tp-goals">{t("training.profile.goals")}</Label><Textarea id="tp-goals" maxLength={4000} value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} /></div>
      <div><Label htmlFor="tp-notes">{t("training.profile.notes")}</Label><Textarea id="tp-notes" maxLength={4000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor="tp-level">{t("training.profile.level")}</Label><Input id="tp-level" maxLength={80} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></div>
        <div><Label htmlFor="tp-focus">{t("training.profile.focus")}</Label><Input id="tp-focus" value={f.focus} placeholder={t("training.profile.focusHint")} onChange={(e) => setF({ ...f, focus: e.target.value })} /></div>
      </div>
      <p className="text-xs text-ink-4">{t("training.profile.visibility")}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => { setMsg(null); run(() => saveTrainingProfile({ athleteId, goals: f.goals, notes: f.notes, level: f.level, focusAreas: f.focus.split(",").map((s) => s.trim()).filter(Boolean) }), () => setMsg(t("training.common.saved"))); }}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
        {msg && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/** Parent / admin: reschedule to a real free time, or cancel (credit back inside the window). */
export function TrainingBookingActions({ bookingId, serviceId, slotStart, data, isAdmin, hideCancel }: {
  bookingId: string; serviceId: string; slotStart: string; data: TrainingWizardData; isAdmin?: boolean; hideCancel?: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const { err, busy, run } = useAction();
  const [show, setShow] = React.useState(false);
  const [coachId, setCoachId] = React.useState(ANY_COACH);
  const [slot, setSlot] = React.useState<Slot | null>(null);
  const service = data.services.find((s) => s.id === serviceId) ?? null;
  const within = isWithinCancellationWindow(slotStart, data.settings.cancellationHours, new Date());
  const slots = React.useMemo(() => service ? slotsFor({ service, coachId, availability: data.availability, busy: data.busy, venues: data.venues, settings: data.settings, timeZone: f.timeZone }) : [], [service, coachId, data, f.timeZone]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {service && (within || isAdmin) && <Button variant="secondary" size="sm" disabled={busy} onClick={() => setShow((s) => !s)}>{t("training.manage.reschedule")}</Button>}
        {!hideCancel && <Button variant="danger" size="sm" disabled={busy} onClick={() => {
          if (window.confirm(within ? t("training.manage.cancelConfirm") : t("training.manage.cancelLate", { hours: data.settings.cancellationHours }))) run(() => cancelTrainingSession(bookingId));
        }}>{t("training.manage.cancel")}</Button>}
      </div>
      {!within && !isAdmin && <p className="text-xs text-warning">{t("training.manage.lateHint", { hours: data.settings.cancellationHours })}</p>}
      {show && service && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <div className="max-w-xs">
            <Label htmlFor="rs-coach">{t("training.book.coach")}</Label>
            <Select id="rs-coach" value={coachId} onChange={(e) => { setCoachId(e.target.value); setSlot(null); }}>
              <option value={ANY_COACH}>{t("training.book.anyCoach")}</option>
              {data.coaches.filter((c) => service.coachIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <SlotPicker service={service} slots={slots} coaches={data.coaches} venues={data.venues} selected={slot} onSelect={setSlot} />
          {slot && <Button size="sm" disabled={busy} onClick={() => run(() => rescheduleTrainingSession(bookingId, slot.coachId, slot.start), () => { setShow(false); setSlot(null); })}>
            {t("training.manage.moveTo", { when: `${f.date(slot.start, { weekday: true })} · ${f.time(slot.start)}` })}
          </Button>}
        </div>
      )}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

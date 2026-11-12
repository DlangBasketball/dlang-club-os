"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Label } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import {
  deleteBlackout, deleteTemplate, deleteWindow, saveBlackout, saveTemplate, saveVenueHours, saveWindow, updateTrainingSettings,
} from "@/lib/actions/training";
import { useFormat, useLocaleContext, useT } from "@/lib/i18n/client";
import { zonedWallTimeToUtc } from "@/lib/format";
import type { OpeningHours } from "@/lib/training/slots";
import type { AvailabilityData, TrainingService, TrainingSettings, TrainingVenue } from "@/lib/training/data";
import { weekdayName } from "./slot-picker";

const DAYS = [1, 2, 3, 4, 5, 6, 7];

function useDone() {
  const router = useRouter();
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setBusy(true); setErr(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? null); return; }
    after?.();
    router.refresh();
  }
  return { err, busy, run };
}

type Tpl = AvailabilityData["templates"][number];
const emptyTpl = (coachId: string) => ({ id: null as string | null, coachId, weekday: 1, startTime: "10:00", endTime: "18:00", venueId: "", serviceId: "", capacity: "1", validFrom: "", validUntil: "", isActive: true });

/** Weekly templates + one-off windows + blackouts for one coach. */
export function AvailabilityEditor({ coachId, data, venues, services, isAdmin }: {
  coachId: string; data: AvailabilityData; venues: TrainingVenue[]; services: TrainingService[]; isAdmin: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const { intlLocale } = useLocaleContext();
  const { err, busy, run } = useDone();
  const [tpl, setTpl] = React.useState(emptyTpl(coachId));
  const [win, setWin] = React.useState({ date: "", from: "17:00", to: "18:00", venueId: "", serviceId: "", capacity: "1" });
  const [blk, setBlk] = React.useState({ fromDate: "", fromTime: "00:00", toDate: "", toTime: "23:59", reason: "", scope: "coach" as "coach" | "club" | "venue", venueId: "" });
  React.useEffect(() => setTpl(emptyTpl(coachId)), [coachId]);

  const venueName = (id: string | null) => venues.find((v) => v.id === id)?.name ?? null;
  const serviceName = (id: string | null) => services.find((s) => s.id === id)?.name ?? null;
  const templates = data.templates.filter((x) => x.coachId === coachId);
  const windows = data.windows.filter((x) => x.coachId === coachId);
  const blackouts = data.blackouts.filter((x) => x.coachId === coachId || x.coachId === null);

  const editTpl = (x: Tpl & { id: string }) => setTpl({ id: x.id, coachId, weekday: x.weekday, startTime: x.startTime, endTime: x.endTime, venueId: x.venueId ?? "", serviceId: x.serviceId ?? "", capacity: String(x.capacity), validFrom: x.validFrom ?? "", validUntil: x.validUntil ?? "", isActive: x.isActive });
  const at = (date: string, time: string) => zonedWallTimeToUtc(date, time, f.timeZone)?.toISOString() ?? "";

  return (
    <div className="space-y-6">
      {/* Weekly templates */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-2">{t("training.availability.weeklyTitle")}</h3>
        <p className="text-xs text-ink-3">{t("training.availability.weeklyHint", { timeZone: f.timeZone })}</p>
        {templates.length === 0 ? <p className="text-sm text-ink-4">{t("training.availability.noWeekly")}</p> : (
          <ul className="space-y-1">
            {templates.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-28 font-medium text-ink">{weekdayName(intlLocale, x.weekday)}</span>
                  <span className="tnum text-ink-2">{x.startTime} – {x.endTime}</span>
                  {venueName(x.venueId) && <Badge tone="neutral">{venueName(x.venueId)}</Badge>}
                  {serviceName(x.serviceId) && <Badge tone="accent">{serviceName(x.serviceId)}</Badge>}
                  {x.capacity > 1 && <Badge tone="neutral">{t("training.availability.capacityN", { count: x.capacity })}</Badge>}
                  {(x.validFrom || x.validUntil) && <span className="text-xs text-ink-4">{x.validFrom ? f.date(`${x.validFrom}T12:00:00Z`) : "…"} – {x.validUntil ? f.date(`${x.validUntil}T12:00:00Z`) : "…"}</span>}
                  {!x.isActive && <Badge tone="warning">{t("training.common.inactive")}</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={t("common.edit")} onClick={() => editTpl(x)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={t("common.delete")} disabled={busy} onClick={() => window.confirm(t("training.availability.confirmDelete")) && run(() => deleteTemplate(x.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 items-end gap-2 rounded-lg border border-line bg-surface-elevated/50 p-3 sm:grid-cols-4 lg:grid-cols-8">
          <div><Label htmlFor="tp-day">{t("training.availability.weekday")}</Label>
            <Select id="tp-day" value={tpl.weekday} onChange={(e) => setTpl({ ...tpl, weekday: Number(e.target.value) })}>
              {DAYS.map((d) => <option key={d} value={d}>{weekdayName(intlLocale, d)}</option>)}
            </Select></div>
          <div><Label htmlFor="tp-from">{t("training.availability.from")}</Label><Input id="tp-from" type="time" value={tpl.startTime} onChange={(e) => setTpl({ ...tpl, startTime: e.target.value })} /></div>
          <div><Label htmlFor="tp-to">{t("training.availability.to")}</Label><Input id="tp-to" type="time" value={tpl.endTime} onChange={(e) => setTpl({ ...tpl, endTime: e.target.value })} /></div>
          <div><Label htmlFor="tp-venue">{t("training.availability.venue")}</Label>
            <Select id="tp-venue" value={tpl.venueId} onChange={(e) => setTpl({ ...tpl, venueId: e.target.value })}>
              <option value="">{t("training.availability.serviceDefault")}</option>
              {venues.filter((v) => v.isActive).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select></div>
          <div><Label htmlFor="tp-svc">{t("training.availability.service")}</Label>
            <Select id="tp-svc" value={tpl.serviceId} onChange={(e) => setTpl({ ...tpl, serviceId: e.target.value })}>
              <option value="">{t("training.availability.allServices")}</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select></div>
          <div><Label htmlFor="tp-cap">{t("training.availability.capacity")}</Label><Input id="tp-cap" type="number" min={1} max={100} value={tpl.capacity} onChange={(e) => setTpl({ ...tpl, capacity: e.target.value })} /></div>
          <div><Label htmlFor="tp-vf">{t("training.availability.validFrom")}</Label><Input id="tp-vf" type="date" value={tpl.validFrom} onChange={(e) => setTpl({ ...tpl, validFrom: e.target.value })} /></div>
          <div><Label htmlFor="tp-vu">{t("training.availability.validUntil")}</Label><Input id="tp-vu" type="date" value={tpl.validUntil} onChange={(e) => setTpl({ ...tpl, validUntil: e.target.value })} /></div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={tpl.isActive} onChange={(e) => setTpl({ ...tpl, isActive: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("training.common.active")}</label>
          <div className="col-span-2 flex gap-2 lg:col-span-6">
            <Button size="sm" disabled={busy} onClick={() => run(() => saveTemplate({ ...tpl, capacity: Number(tpl.capacity), venueId: tpl.venueId || null, serviceId: tpl.serviceId || null }), () => setTpl(emptyTpl(coachId)))}>
              <Plus className="h-4 w-4" /> {tpl.id ? t("common.save") : t("training.availability.addWeekly")}
            </Button>
            {tpl.id && <Button size="sm" variant="ghost" onClick={() => setTpl(emptyTpl(coachId))}>{t("common.cancel")}</Button>}
          </div>
        </div>
      </section>

      {/* One-off windows */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-2">{t("training.availability.oneOffTitle")}</h3>
        {windows.length === 0 ? <p className="text-sm text-ink-4">{t("training.availability.noOneOff")}</p> : (
          <ul className="space-y-1">
            {windows.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink">{f.date(w.startsAt, { weekday: true })} · <span className="tnum">{f.time(w.startsAt)} – {f.time(w.endsAt)}</span></span>
                  {venueName(w.venueId) && <Badge tone="neutral">{venueName(w.venueId)}</Badge>}
                  {serviceName(w.serviceId) && <Badge tone="accent">{serviceName(w.serviceId)}</Badge>}
                  {w.capacity > 1 && <Badge tone="neutral">{t("training.availability.capacityN", { count: w.capacity })}</Badge>}
                  {w.isBooked && <Badge tone="warning">{t("training.availability.legacyBooked")}</Badge>}
                </div>
                {!w.isBooked && <Button size="sm" variant="ghost" aria-label={t("common.delete")} disabled={busy} onClick={() => window.confirm(t("training.availability.confirmDelete")) && run(() => deleteWindow(w.id))}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 items-end gap-2 rounded-lg border border-line bg-surface-elevated/50 p-3 sm:grid-cols-3 lg:grid-cols-7">
          <div><Label htmlFor="ow-date">{t("training.availability.date")}</Label><Input id="ow-date" type="date" value={win.date} onChange={(e) => setWin({ ...win, date: e.target.value })} /></div>
          <div><Label htmlFor="ow-from">{t("training.availability.from")}</Label><Input id="ow-from" type="time" value={win.from} onChange={(e) => setWin({ ...win, from: e.target.value })} /></div>
          <div><Label htmlFor="ow-to">{t("training.availability.to")}</Label><Input id="ow-to" type="time" value={win.to} onChange={(e) => setWin({ ...win, to: e.target.value })} /></div>
          <div><Label htmlFor="ow-venue">{t("training.availability.venue")}</Label>
            <Select id="ow-venue" value={win.venueId} onChange={(e) => setWin({ ...win, venueId: e.target.value })}>
              <option value="">{t("training.availability.serviceDefault")}</option>
              {venues.filter((v) => v.isActive).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select></div>
          <div><Label htmlFor="ow-svc">{t("training.availability.service")}</Label>
            <Select id="ow-svc" value={win.serviceId} onChange={(e) => setWin({ ...win, serviceId: e.target.value })}>
              <option value="">{t("training.availability.allServices")}</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select></div>
          <div><Label htmlFor="ow-cap">{t("training.availability.capacity")}</Label><Input id="ow-cap" type="number" min={1} max={100} value={win.capacity} onChange={(e) => setWin({ ...win, capacity: e.target.value })} /></div>
          <Button size="sm" disabled={busy || !win.date} onClick={() => run(() => saveWindow({ coachId, startsAt: at(win.date, win.from), endsAt: at(win.date, win.to), venueId: win.venueId || null, serviceId: win.serviceId || null, capacity: Number(win.capacity) }), () => setWin({ ...win, date: "" }))}>
            <Plus className="h-4 w-4" /> {t("training.availability.addOneOff")}
          </Button>
        </div>
      </section>

      {/* Blackouts */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-2">{t("training.availability.blackoutsTitle")}</h3>
        {blackouts.length === 0 ? <p className="text-sm text-ink-4">{t("training.availability.noBlackouts")}</p> : (
          <ul className="space-y-1">
            {blackouts.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink">{f.dateTime(b.startsAt)} – {f.dateTime(b.endsAt)}</span>
                  <Badge tone={b.coachId ? "neutral" : "warning"}>{b.coachId ? t("training.availability.scopeCoach") : b.venueId ? venueName(b.venueId) ?? t("training.availability.scopeVenue") : t("training.availability.scopeClub")}</Badge>
                  {b.reason && <span className="text-xs text-ink-3">{b.reason}</span>}
                </div>
                {(isAdmin || b.coachId) && <Button size="sm" variant="ghost" aria-label={t("common.delete")} disabled={busy} onClick={() => window.confirm(t("training.availability.confirmDelete")) && run(() => deleteBlackout(b.id))}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 items-end gap-2 rounded-lg border border-line bg-surface-elevated/50 p-3 sm:grid-cols-4 lg:grid-cols-8">
          <div><Label htmlFor="bo-fd">{t("training.availability.fromDate")}</Label><Input id="bo-fd" type="date" value={blk.fromDate} onChange={(e) => setBlk({ ...blk, fromDate: e.target.value, toDate: blk.toDate || e.target.value })} /></div>
          <div><Label htmlFor="bo-ft">{t("training.availability.from")}</Label><Input id="bo-ft" type="time" value={blk.fromTime} onChange={(e) => setBlk({ ...blk, fromTime: e.target.value })} /></div>
          <div><Label htmlFor="bo-td">{t("training.availability.toDate")}</Label><Input id="bo-td" type="date" value={blk.toDate} onChange={(e) => setBlk({ ...blk, toDate: e.target.value })} /></div>
          <div><Label htmlFor="bo-tt">{t("training.availability.to")}</Label><Input id="bo-tt" type="time" value={blk.toTime} onChange={(e) => setBlk({ ...blk, toTime: e.target.value })} /></div>
          {isAdmin && (
            <div><Label htmlFor="bo-scope">{t("training.availability.scope")}</Label>
              <Select id="bo-scope" value={blk.scope} onChange={(e) => setBlk({ ...blk, scope: e.target.value as typeof blk.scope })}>
                <option value="coach">{t("training.availability.scopeCoach")}</option>
                <option value="club">{t("training.availability.scopeClub")}</option>
                <option value="venue">{t("training.availability.scopeVenue")}</option>
              </Select></div>
          )}
          {isAdmin && blk.scope === "venue" && (
            <div><Label htmlFor="bo-venue">{t("training.availability.venue")}</Label>
              <Select id="bo-venue" value={blk.venueId} onChange={(e) => setBlk({ ...blk, venueId: e.target.value })}>
                <option value="">—</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select></div>
          )}
          <div className="col-span-2"><Label htmlFor="bo-reason">{t("training.availability.reason")}</Label><Input id="bo-reason" maxLength={300} value={blk.reason} onChange={(e) => setBlk({ ...blk, reason: e.target.value })} /></div>
          <Button size="sm" disabled={busy || !blk.fromDate || !blk.toDate || (blk.scope === "venue" && !blk.venueId)} onClick={() => run(() => saveBlackout({
            coachId: blk.scope === "coach" ? coachId : null, venueId: blk.scope === "venue" ? blk.venueId : null,
            startsAt: at(blk.fromDate, blk.fromTime), endsAt: at(blk.toDate, blk.toTime), reason: blk.reason,
          }), () => setBlk({ ...blk, fromDate: "", toDate: "", reason: "" }))}>
            <Plus className="h-4 w-4" /> {t("training.availability.addBlackout")}
          </Button>
        </div>
      </section>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/** Opening hours of one venue (default bounds for bookable times). */
export function VenueHoursEditor({ venue }: { venue: TrainingVenue }) {
  const t = useT();
  const { intlLocale } = useLocaleContext();
  const { err, busy, run } = useDone();
  const init = (h: OpeningHours) => Object.fromEntries(DAYS.map((d) => {
    const r = h?.[String(d)]?.[0];
    return [d, { open: Boolean(r) || !h, from: r?.[0] ?? "10:00", to: r?.[1] ?? "18:00" }];
  })) as Record<number, { open: boolean; from: string; to: string }>;
  const [enabled, setEnabled] = React.useState(Boolean(venue.openingHours && Object.keys(venue.openingHours).length));
  const [days, setDays] = React.useState(init(venue.openingHours));
  const [msg, setMsg] = React.useState<string | null>(null);

  function save() {
    setMsg(null);
    const hours = enabled
      ? Object.fromEntries(DAYS.filter((d) => days[d].open).map((d) => [String(d), [[days[d].from, days[d].to]]]))
      : null;
    run(() => saveVenueHours(venue.id, hours as Record<string, [string, string][]> | null), () => setMsg(t("training.common.saved")));
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("training.venue.limitHours")}</label>
      {enabled && (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {DAYS.map((d) => (
            <div key={d} className="flex items-center gap-2 text-sm">
              <label className="flex w-32 items-center gap-2 text-ink-2"><input type="checkbox" checked={days[d].open} onChange={(e) => setDays({ ...days, [d]: { ...days[d], open: e.target.checked } })} className="h-4 w-4 accent-[var(--red-primary)]" />{weekdayName(intlLocale, d, "short")}</label>
              {days[d].open ? <>
                <Input aria-label={t("training.availability.from")} type="time" value={days[d].from} onChange={(e) => setDays({ ...days, [d]: { ...days[d], from: e.target.value } })} className="w-28" />
                <span className="text-ink-4">–</span>
                <Input aria-label={t("training.availability.to")} type="time" value={days[d].to} onChange={(e) => setDays({ ...days, [d]: { ...days[d], to: e.target.value } })} className="w-28" />
              </> : <span className="text-xs text-ink-4">{t("training.venue.closed")}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={save}>{busy ? t("common.saving") : t("common.save")}</Button>
        {msg && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/** Online booking rules: enabled, cancellation window, credit refund, slot step, lead time, horizon. */
export function TrainingSettingsForm({ settings }: { settings: TrainingSettings }) {
  const t = useT();
  const { err, busy, run } = useDone();
  const [f, setF] = React.useState(settings);
  const [msg, setMsg] = React.useState<string | null>(null);
  const num = (k: keyof TrainingSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("training.settings.enabled")}</label>
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={f.refundCreditsOnCancel} onChange={(e) => setF({ ...f, refundCreditsOnCancel: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("training.settings.refund")}</label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><Label htmlFor="ts-cancel">{t("training.settings.cancellationHours")}</Label><Input id="ts-cancel" type="number" min={0} max={720} value={f.cancellationHours} onChange={num("cancellationHours")} /></div>
        <div><Label htmlFor="ts-step">{t("training.settings.slotStep")}</Label><Input id="ts-step" type="number" min={5} max={240} step={5} value={f.slotStepMin} onChange={num("slotStepMin")} /></div>
        <div><Label htmlFor="ts-lead">{t("training.settings.leadHours")}</Label><Input id="ts-lead" type="number" min={0} max={720} value={f.leadHours} onChange={num("leadHours")} /></div>
        <div><Label htmlFor="ts-horizon">{t("training.settings.horizonDays")}</Label><Input id="ts-horizon" type="number" min={1} max={120} value={f.horizonDays} onChange={num("horizonDays")} /></div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => { setMsg(null); run(() => updateTrainingSettings(f), () => setMsg(t("training.common.saved"))); }}>{busy ? t("common.saving") : t("common.save")}</Button>
        {msg && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}


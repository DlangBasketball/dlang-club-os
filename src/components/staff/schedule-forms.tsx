"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { deleteShiftTemplate, saveShiftTemplate, setVenueGeofence } from "@/lib/actions/staff-time";
import { isOvernight, isoWeekdayName } from "@/lib/staff/hours";
import type { TemplateView, VenueGeo } from "@/lib/staff/data";

type Draft = {
  id: string | null; profileId: string; venueId: string; weekday: number; startTime: string; endTime: string;
  validFrom: string; validUntil: string; label: string; isActive: boolean;
};

/** Planned weekly shifts: list + inline add / edit / delete (admin). */
export function ShiftTemplates({
  templates, employees, venues, intlLocale,
}: {
  templates: TemplateView[];
  employees: { profileId: string; name: string }[];
  venues: { id: string; name: string }[];
  intlLocale: string;
}) {
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const venueName = new Map(venues.map((v) => [v.id, v.name]));
  const byEmployee = employees.map((e) => ({ ...e, rows: templates.filter((x) => x.profileId === e.profileId) }));

  const blank = (profileId: string): Draft => ({
    id: null, profileId, venueId: "", weekday: 1, startTime: "16:00", endTime: "20:00", validFrom: "", validUntil: "", label: "", isActive: true,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    const res = await saveShiftTemplate({ ...draft, venueId: draft.venueId || null, label: draft.label || null });
    setBusy(false);
    if (res.ok) {
      setDraft(null);
      setMsg({ ok: true, text: res.message ?? "" });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }
  async function remove(id: string) {
    if (!window.confirm(t("staff.schedules.confirmDelete"))) return;
    setBusy(true);
    const res = await deleteShiftTemplate(id);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  const form = draft && (
    <form onSubmit={save} className="space-y-3 rounded-md border border-border bg-surface-elevated p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label htmlFor="st-emp">{t("staff.schedules.employee")}</Label>
          <Select id="st-emp" value={draft.profileId} onChange={(e) => setDraft({ ...draft, profileId: e.target.value })}>
            {employees.map((x) => <option key={x.profileId} value={x.profileId}>{x.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="st-day">{t("staff.schedules.weekday")}</Label>
          <Select id="st-day" value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{isoWeekdayName(intlLocale, d)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="st-venue">{t("staff.schedules.venue")}</Label>
          <Select id="st-venue" value={draft.venueId} onChange={(e) => setDraft({ ...draft, venueId: e.target.value })}>
            <option value="">{t("staff.schedules.noVenue")}</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="st-start">{t("staff.schedules.start")}</Label>
          <Input id="st-start" type="time" required value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="st-end">{t("staff.schedules.end")}</Label>
          <Input id="st-end" type="time" required value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="st-from">{t("staff.schedules.validFrom")}</Label>
          <Input id="st-from" type="date" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="st-until">{t("staff.schedules.validUntil")}</Label>
          <Input id="st-until" type="date" value={draft.validUntil} onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })} />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="st-label">{t("staff.schedules.label")}</Label>
          <Input id="st-label" maxLength={120} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm text-text">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> {t("staff.schedules.active")}
        </label>
      </div>
      {isOvernight(draft.startTime, draft.endTime) && <p className="text-xs text-text-muted">{t("staff.schedules.overnight")}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>{t("staff.schedules.save")}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setDraft(null)}>{t("staff.timesheets.detail.cancel")}</Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-4">
      {!draft && employees.length > 0 && (
        <Button type="button" size="sm" onClick={() => { setMsg(null); setDraft(blank(employees[0].profileId)); }}>
          <Plus className="h-4 w-4" /> {t("staff.schedules.add")}
        </Button>
      )}
      {form}
      {msg && msg.text && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      {templates.length === 0 && <p className="text-sm text-text-muted">{t("staff.schedules.empty")}</p>}
      <div className="space-y-4">
        {byEmployee.filter((e) => e.rows.length > 0).map((e) => (
          <section key={e.profileId}>
            <h3 className="mb-1.5 text-sm font-medium text-text">{e.name}</h3>
            <ul className="divide-y divide-border-soft rounded-md border border-border">
              {e.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-28 text-text">{isoWeekdayName(intlLocale, r.weekday)}</span>
                    <span className="tnum text-text">{r.startTime}–{r.endTime}</span>
                    {isOvernight(r.startTime, r.endTime) && <Badge tone="info">{t("staff.schedules.overnight")}</Badge>}
                    <span className="text-text-muted">{r.venueId ? venueName.get(r.venueId) : t("staff.schedules.noVenue")}</span>
                    {r.label && <span className="text-text-muted">· {r.label}</span>}
                    {!r.isActive && <Badge tone="neutral">{t("staff.schedules.inactive")}</Badge>}
                    {(r.validFrom || r.validUntil) && <span className="tnum text-xs text-text-muted">{r.validFrom ?? "…"} → {r.validUntil ?? "…"}</span>}
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" disabled={busy}
                      onClick={() => setDraft({ id: r.id, profileId: r.profileId, venueId: r.venueId ?? "", weekday: r.weekday, startTime: r.startTime, endTime: r.endTime, validFrom: r.validFrom ?? "", validUntil: r.validUntil ?? "", label: r.label ?? "", isActive: r.isActive })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => remove(r.id)} aria-label={t("staff.schedules.delete")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Venue coordinates + radius for the optional clock-in location check. */
export function VenueGeofences({ venues }: { venues: VenueGeo[] }) {
  const t = useT();
  const router = useRouter();
  const [vals, setVals] = React.useState(() =>
    Object.fromEntries(venues.map((v) => [v.id, { lat: v.latitude?.toString() ?? "", lng: v.longitude?.toString() ?? "", r: String(v.radiusM) }])),
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function save(id: string) {
    const v = vals[id];
    setBusy(id);
    const res = await setVenueGeofence({ venueId: id, latitude: v.lat, longitude: v.lng, radiusM: Number(v.r) });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-3">
      {venues.map((v) => (
        <div key={v.id} className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_9rem_7rem_auto]">
          <div className="text-sm text-text">{v.name}</div>
          <div>
            <Label htmlFor={`g-lat-${v.id}`}>{t("staff.schedules.geofence.latitude")}</Label>
            <Input id={`g-lat-${v.id}`} inputMode="decimal" value={vals[v.id].lat} placeholder={t("staff.schedules.geofence.notSet")}
              onChange={(e) => setVals({ ...vals, [v.id]: { ...vals[v.id], lat: e.target.value } })} />
          </div>
          <div>
            <Label htmlFor={`g-lng-${v.id}`}>{t("staff.schedules.geofence.longitude")}</Label>
            <Input id={`g-lng-${v.id}`} inputMode="decimal" value={vals[v.id].lng} placeholder={t("staff.schedules.geofence.notSet")}
              onChange={(e) => setVals({ ...vals, [v.id]: { ...vals[v.id], lng: e.target.value } })} />
          </div>
          <div>
            <Label htmlFor={`g-r-${v.id}`}>{t("staff.schedules.geofence.radius")}</Label>
            <Input id={`g-r-${v.id}`} type="number" min={25} max={5000} value={vals[v.id].r}
              onChange={(e) => setVals({ ...vals, [v.id]: { ...vals[v.id], r: e.target.value } })} />
          </div>
          <Button type="button" size="sm" variant="secondary" loading={busy === v.id} disabled={!!busy} onClick={() => save(v.id)}>
            {t("staff.schedules.geofence.save")}
          </Button>
        </div>
      ))}
      {msg && msg.text && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}

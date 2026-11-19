"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, MapPin, Plus, Trash2 } from "lucide-react";
import { Badge, Button, FieldHint, Input, Label, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { removeLocationPhoto, saveLocation, uploadLocationPhoto } from "@/lib/actions/locations";
import { addVenueSpace } from "@/lib/sportsops/actions";
import { formatHoursLine, mapLinkFor, parseHoursLine, WEEKDAYS } from "@/lib/sports/locations";

export type LocationValue = {
  name: string; address: string; city: string; postalCode: string; country: string; capacity: string; notes: string; mapUrl: string;
  latitude: string; longitude: string; geofenceRadiusM: string; hours: Record<string, [string, string][]>; isActive: boolean;
};

/** Full venue editor: address, map link, opening hours, geofence, photo, spaces, active. */
export function LocationForm({ id, initial, photoUrl, spaces }: {
  id: string | null; initial: LocationValue; photoUrl: string | null; spaces: { id: string; name: string; isActive: boolean }[];
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [v, setV] = React.useState(initial);
  const [lines, setLines] = React.useState<Record<string, string>>(() => Object.fromEntries(WEEKDAYS.map((d) => [d, formatHoursLine(initial.hours[d])])));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [space, setSpace] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const set = <K extends keyof LocationValue>(k: K, val: LocationValue[K]) => setV((s) => ({ ...s, [k]: val }));
  // ISO weekday (1 = Monday … 7 = Sunday); 2026-11-01 is a Sunday.
  const dayFmt = React.useMemo(() => new Intl.DateTimeFormat(f.locale, { weekday: "long", timeZone: "UTC" }), [f.locale]);
  const dayName = (iso: string) => dayFmt.format(new Date(Date.UTC(2026, 10, 1 + (Number(iso) % 7))));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hours: Record<string, [string, string][]> = {};
    for (const d of WEEKDAYS) {
      const parsed = parseHoursLine(lines[d] ?? "");
      if (parsed === null) return setMsg({ ok: false, text: t("sports.locations.errors.hours") });
      if (parsed.length) hours[d] = parsed;
    }
    setBusy(true); setMsg(null);
    const res = await saveLocation(id, {
      name: v.name, address: v.address, city: v.city, postalCode: v.postalCode, country: v.country, capacity: v.capacity === "" ? null : Number(v.capacity),
      notes: v.notes, mapUrl: v.mapUrl, latitude: v.latitude === "" ? null : Number(v.latitude), longitude: v.longitude === "" ? null : Number(v.longitude),
      geofenceRadiusM: Number(v.geofenceRadiusM || 300), openingHours: Object.keys(hours).length ? (hours as Record<"1", [string, string][]>) : null, isActive: v.isActive,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: t("sports.saved") });
    if (!id && res.data?.id) router.push(`/admin/locations/${res.data.id}`);
    else router.refresh();
  }
  async function upload(file: File) {
    if (!id) return;
    const fd = new FormData();
    fd.set("venueId", id);
    fd.set("file", file);
    setBusy(true);
    const res = await uploadLocationPhoto(fd);
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    router.refresh();
  }
  async function addSpace() {
    if (!id || !space.trim()) return;
    const res = await addVenueSpace(id, space.trim());
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setSpace("");
    router.refresh();
  }

  const map = mapLinkFor({ mapUrl: v.mapUrl, latitude: v.latitude === "" ? null : Number(v.latitude), longitude: v.longitude === "" ? null : Number(v.longitude), address: v.address, city: v.city, postalCode: v.postalCode });
  const field = (k: keyof LocationValue, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div><Label htmlFor={`loc-${k}`}>{label}</Label>
      <Input id={`loc-${k}`} value={v[k] as string} onChange={(e) => set(k, e.target.value as never)} {...props} /></div>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{field("name", t("sports.locations.name"), { required: true, maxLength: 120 })}</div>
        {field("address", t("sports.locations.address"), { maxLength: 200 })}
        {field("postalCode", t("sports.locations.postalCode"), { maxLength: 20 })}
        {field("city", t("sports.locations.city"), { maxLength: 100 })}
        {field("country", t("sports.locations.country"), { maxLength: 2, placeholder: "CH" })}
        {field("capacity", t("sports.locations.capacity"), { type: "number", min: 0 })}
        <div>{field("mapUrl", t("sports.locations.mapUrl"), { type: "url", maxLength: 500, placeholder: "https://" })}
          {map && <a href={map} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-primary hover:underline"><MapPin className="h-3 w-3" aria-hidden /> {t("sports.locations.openMap")}</a>}</div>
        <div className="sm:col-span-2"><Label htmlFor="loc-notes">{t("sports.locations.notes")}</Label>
          <Textarea id="loc-notes" rows={3} maxLength={2000} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      </div>

      <fieldset className="space-y-2 rounded-md border border-border p-4">
        <legend className="px-1 text-xs uppercase tracking-[0.12em] text-text-muted">{t("sports.locations.hours")}</legend>
        <FieldHint>{t("sports.locations.hoursHint")}</FieldHint>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {WEEKDAYS.map((d) => (
            <div key={d} className="flex items-center gap-2">
              <Label htmlFor={`loc-h-${d}`} className="mb-0 w-28 shrink-0">{dayName(d)}</Label>
              <Input id={`loc-h-${d}`} value={lines[d] ?? ""} placeholder={t("sports.locations.closed")} maxLength={60}
                onChange={(e) => setLines((s) => ({ ...s, [d]: e.target.value }))} className="font-mono" />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-3">
        <legend className="px-1 text-xs uppercase tracking-[0.12em] text-text-muted">{t("sports.locations.geofence")}</legend>
        {field("latitude", t("sports.locations.latitude"), { type: "number", step: "0.000001", min: -90, max: 90 })}
        {field("longitude", t("sports.locations.longitude"), { type: "number", step: "0.000001", min: -180, max: 180 })}
        {field("geofenceRadiusM", t("sports.locations.radius"), { type: "number", min: 25, max: 5000 })}
        <FieldHint className="sm:col-span-3">{t("sports.locations.geofenceHint")}</FieldHint>
      </fieldset>

      {id && (
        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <legend className="px-1 text-xs uppercase tracking-[0.12em] text-text-muted">{t("sports.locations.photo")}</legend>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photoUrl && <img src={photoUrl} alt={t("sports.locations.photoAlt", { name: v.name })} className="max-h-48 rounded-md border border-border object-cover" />}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}><ImagePlus className="h-4 w-4" aria-hidden /> {t("sports.locations.uploadPhoto")}</Button>
            {photoUrl && <Button type="button" size="sm" variant="ghost" onClick={async () => { await removeLocationPhoto(id); router.refresh(); }}><Trash2 className="h-4 w-4 text-danger" aria-hidden /> {t("sports.locations.removePhoto")}</Button>}
          </div>
        </fieldset>
      )}

      {id && (
        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <legend className="px-1 text-xs uppercase tracking-[0.12em] text-text-muted">{t("sports.locations.spaces")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {spaces.length === 0 ? <span className="text-xs text-text-muted">{t("sports.locations.noSpaces")}</span>
              : spaces.map((s) => <Badge key={s.id} tone={s.isActive ? "neutral" : "warning"}>{s.name}</Badge>)}
          </div>
          <div className="flex gap-2">
            <Input value={space} onChange={(e) => setSpace(e.target.value)} maxLength={80} placeholder={t("sports.locations.spacePlaceholder")} aria-label={t("sports.locations.spacePlaceholder")} className="max-w-xs" />
            <Button type="button" size="sm" variant="secondary" onClick={addSpace} disabled={!space.trim()}><Plus className="h-4 w-4" aria-hidden /> {t("sports.locations.addSpace")}</Button>
          </div>
        </fieldset>
      )}

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("sports.locations.active")}</label>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      <Button type="submit" loading={busy}>{id ? t("common.save") : t("sports.locations.create")}</Button>
    </form>
  );
}

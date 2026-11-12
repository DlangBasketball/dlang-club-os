"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, Trash2, Users, MapPin } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select, Textarea } from "@/components/ui";
import {
  deleteCampRow, deleteEdition, duplicateEdition, saveAgeGroup, saveEdition, savePriceOption, saveTimeSlot,
} from "@/lib/actions/camps";
import { EDITION_STATUSES } from "@/lib/camps/validation";
import type { CampAdminData, CampEdition } from "@/lib/camps/data";
import { zonedParts } from "@/lib/club-ops/validation";
import { zonedWallTimeToUtc } from "@/lib/format";
import { useFormat, useT } from "@/lib/i18n/client";

const OTHER = "__other";
/** Form text -> number for the zod schemas ("" stays empty = not set). */
const opt = (s: string): number | "" => (s.trim() === "" ? "" : Number(s));
const TONE = { draft: "warning", published: "success", archived: "neutral", cancelled: "danger" } as const;

function toLocalInput(iso: string | null, tz: string): string {
  const p = zonedParts(iso, tz);
  return p.date ? `${p.date}T${p.time}` : "";
}
function fromLocalInput(v: string, tz: string): string {
  if (!v) return "";
  const [d, t] = v.split("T");
  return zonedWallTimeToUtc(d, t ?? "00:00", tz)?.toISOString() ?? "";
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  async function run(fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, okText?: string) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: String(res.error ?? "") }); return res; }
    if (okText) setMsg({ tone: "ok", text: okText });
    router.refresh();
    return res;
  }
  const note = msg ? <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p> : null;
  return { busy, run, note };
}

export function CampEditor({ programId, data, currency }: { programId: string; data: CampAdminData; currency: string }) {
  return (
    <div className="space-y-5">
      <EditionsSection programId={programId} data={data} />
      <PriceOptionsSection programId={programId} data={data} currency={currency} />
      <AgeGroupsSection programId={programId} data={data} />
      <TimeSlotsSection programId={programId} data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------
function placeLabel(e: CampEdition): string {
  if (e.venue) return [e.venue.name, e.venue.city ?? e.city].filter(Boolean).join(", ");
  return [e.locationName, e.address, e.city].filter(Boolean).join(", ");
}

function EditionsSection({ programId, data }: { programId: string; data: CampAdminData }) {
  const t = useT();
  const f = useFormat();
  const [editing, setEditing] = React.useState<string | null>(null);
  const { busy, run, note } = useAction();

  async function remove(e: CampEdition) {
    const text = e.registrations > 0 ? t("camps.editions.confirmArchive", { count: e.registrations }) : t("camps.editions.confirmDelete");
    if (!window.confirm(text)) return;
    await run(() => deleteEdition(e.id), e.registrations > 0 ? t("camps.editions.archived") : t("camps.editions.deleted"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("camps.editions.title")}</CardTitle>
        {editing !== "new" && <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> {t("camps.editions.add")}</Button>}
      </CardHeader>
      <CardBody className="space-y-3">
        {editing === "new" && <EditionForm programId={programId} venues={data.venues} onDone={() => setEditing(null)} />}
        {data.editions.length === 0 && editing !== "new" && <p className="text-sm text-ink-3">{t("camps.editions.empty")}</p>}
        {data.editions.map((e) => (
          <div key={e.id} className={`rounded-md border border-line p-3 ${e.status === "archived" ? "opacity-60" : ""}`}>
            {editing === e.id ? (
              <EditionForm programId={programId} venues={data.venues} edition={e} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{e.name || f.dateRange(e.startsOn, e.endsOn)}</span>
                    <Badge tone={TONE[e.status]}>{t(`camps.editionStatus.${e.status}`)}</Badge>
                  </div>
                  <div className="text-xs text-ink-3">{f.dateRange(e.startsOn, e.endsOn)}</div>
                  {placeLabel(e) && <div className="flex items-center gap-1 text-xs text-ink-3"><MapPin className="h-3 w-3" />{placeLabel(e)}</div>}
                  <div className="text-xs text-ink-2">
                    {e.capacity !== null
                      ? t("camps.editions.capacityLine", { taken: e.taken, capacity: e.capacity, left: e.spotsLeft ?? 0 })
                      : t("camps.editions.registeredLine", { taken: e.taken })}
                  </div>
                  {e.registrationClosesAt && <div className="text-xs text-ink-3">{t("camps.editions.closesOn", { date: f.dateTime(e.registrationClosesAt) })}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/programs/${programId}/editions/${e.id}`}><Button size="sm" variant="secondary"><Users className="h-4 w-4" /> {t("camps.editions.registrations", { count: e.registrations })}</Button></Link>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(e.id)}><Pencil className="h-4 w-4" /> {t("common.edit")}</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => duplicateEdition(e.id), t("camps.editions.duplicated"))}><Copy className="h-4 w-4" /> {t("camps.editions.duplicate")}</Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => remove(e)}><Trash2 className="h-4 w-4" /> {e.registrations > 0 ? t("camps.editions.archive") : t("common.delete")}</Button>
                </div>
              </div>
            )}
          </div>
        ))}
        {note}
      </CardBody>
    </Card>
  );
}

function EditionForm({ programId, venues, edition, onDone }: {
  programId: string; venues: CampAdminData["venues"]; edition?: CampEdition; onDone: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const { busy, run, note } = useAction();
  const [v, setV] = React.useState({
    name: edition?.name ?? "",
    startsOn: edition?.startsOn ?? "",
    endsOn: edition?.endsOn ?? "",
    status: edition?.status ?? ("draft" as CampEdition["status"]),
    place: edition?.venueId ?? (edition ? OTHER : venues[0]?.id ?? OTHER),
    locationName: edition?.locationName ?? "",
    address: edition?.address ?? "",
    city: edition?.city ?? "",
    capacity: edition?.capacity != null ? String(edition.capacity) : "",
    opensAt: toLocalInput(edition?.registrationOpensAt ?? null, f.timeZone),
    closesAt: toLocalInput(edition?.registrationClosesAt ?? null, f.timeZone),
    notes: edition?.notes ?? "",
  });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const id = edition?.id ?? "new";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const venueId = v.place !== OTHER ? v.place : null;
    const res = await run(() => saveEdition(programId, edition?.id ?? null, {
      name: v.name, startsOn: v.startsOn, endsOn: v.endsOn, status: v.status, venueId,
      locationName: v.locationName, address: v.address, city: v.city || (venueId ? venues.find((x) => x.id === venueId)?.city ?? "" : ""),
      capacity: opt(v.capacity), registrationOpensAt: fromLocalInput(v.opensAt, f.timeZone), registrationClosesAt: fromLocalInput(v.closesAt, f.timeZone),
      notes: v.notes,
    }));
    if (res.ok) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor={`ed-name-${id}`}>{t("camps.editions.name")}</Label><Input id={`ed-name-${id}`} maxLength={120} value={v.name} placeholder={t("camps.editions.namePlaceholder")} onChange={(e) => set("name", e.target.value)} /></div>
        <div><Label htmlFor={`ed-start-${id}`}>{t("camps.editions.startsOn")}</Label><Input id={`ed-start-${id}`} type="date" required value={v.startsOn} onChange={(e) => set("startsOn", e.target.value)} /></div>
        <div><Label htmlFor={`ed-end-${id}`}>{t("camps.editions.endsOn")}</Label><Input id={`ed-end-${id}`} type="date" required value={v.endsOn} onChange={(e) => set("endsOn", e.target.value)} /></div>
        <div><Label htmlFor={`ed-place-${id}`}>{t("camps.editions.venue")}</Label>
          <Select id={`ed-place-${id}`} value={v.place} onChange={(e) => set("place", e.target.value)}>
            {venues.map((x) => <option key={x.id} value={x.id}>{x.city ? `${x.name} (${x.city})` : x.name}</option>)}
            <option value={OTHER}>{t("camps.editions.otherAddress")}</option>
          </Select>
        </div>
        <div><Label htmlFor={`ed-city-${id}`}>{t("camps.editions.city")}</Label><Input id={`ed-city-${id}`} maxLength={100} value={v.city} onChange={(e) => set("city", e.target.value)} /></div>
        {v.place === OTHER && (<>
          <div><Label htmlFor={`ed-locname-${id}`}>{t("camps.editions.locationName")}</Label><Input id={`ed-locname-${id}`} maxLength={200} value={v.locationName} onChange={(e) => set("locationName", e.target.value)} /></div>
          <div><Label htmlFor={`ed-addr-${id}`}>{t("camps.editions.address")}</Label><Input id={`ed-addr-${id}`} maxLength={200} value={v.address} onChange={(e) => set("address", e.target.value)} /></div>
        </>)}
        <div><Label htmlFor={`ed-cap-${id}`}>{t("camps.editions.capacity")}</Label><Input id={`ed-cap-${id}`} type="number" min="1" step="1" value={v.capacity} onChange={(e) => set("capacity", e.target.value)} /></div>
        <div><Label htmlFor={`ed-status-${id}`}>{t("common.status")}</Label>
          <Select id={`ed-status-${id}`} value={v.status} onChange={(e) => set("status", e.target.value as CampEdition["status"])}>
            {EDITION_STATUSES.map((s) => <option key={s} value={s}>{t(`camps.editionStatus.${s}`)}</option>)}
          </Select>
        </div>
        <div><Label htmlFor={`ed-open-${id}`}>{t("camps.editions.opensAt")}</Label><Input id={`ed-open-${id}`} type="datetime-local" value={v.opensAt} onChange={(e) => set("opensAt", e.target.value)} /></div>
        <div><Label htmlFor={`ed-close-${id}`}>{t("camps.editions.closesAt")}</Label><Input id={`ed-close-${id}`} type="datetime-local" value={v.closesAt} onChange={(e) => set("closesAt", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`ed-notes-${id}`}>{t("camps.editions.notes")}</Label><Textarea id={`ed-notes-${id}`} maxLength={2000} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      </div>
      <p className="text-xs text-ink-3">{t("camps.editions.windowHint")}</p>
      {note}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDone}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Row editors (price options, age groups, time slots)
// ---------------------------------------------------------------------------
function RowActions({ busy, onDelete, isNew }: { busy: boolean; onDelete: () => void; isNew: boolean }) {
  const t = useT();
  return (
    <div className="flex items-end gap-1">
      <Button type="submit" size="sm" disabled={busy}>{t("common.save")}</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDelete} aria-label={isNew ? t("common.cancel") : t("common.delete")}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}

function EditionScopeSelect({ id, value, onChange, editions }: { id: string; value: string; onChange: (v: string) => void; editions: CampEdition[] }) {
  const t = useT();
  const f = useFormat();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("camps.allEditions")}</option>
      {editions.map((e) => <option key={e.id} value={e.id}>{e.name || f.dateRange(e.startsOn, e.endsOn)}</option>)}
    </Select>
  );
}

type OptionDraft = { key: string; id: string | null; editionId: string; label: string; daysCount: string; includesLunch: boolean; price: string; isActive: boolean; sort: string };

function PriceOptionsSection({ programId, data, currency }: { programId: string; data: CampAdminData; currency: string }) {
  const t = useT();
  const f = useFormat();
  const initial = React.useMemo<OptionDraft[]>(() => data.options.map((o) => ({
    key: o.id, id: o.id, editionId: o.editionId ?? "", label: o.label, daysCount: String(o.daysCount), includesLunch: o.includesLunch,
    price: String(o.price), isActive: o.isActive, sort: String(o.sort),
  })), [data.options]);
  const [rows, setRows] = React.useState(initial);
  React.useEffect(() => setRows(initial), [initial]);
  const add = () => setRows((r) => [...r, { key: `new-${Date.now()}`, id: null, editionId: "", label: "", daysCount: "5", includesLunch: false, price: "", isActive: true, sort: String((r.length + 1) * 10) }]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("camps.options.title")}</CardTitle>
        <Button size="sm" variant="secondary" onClick={add}><Plus className="h-4 w-4" /> {t("camps.options.add")}</Button>
      </CardHeader>
      <CardBody className="space-y-2">
        <p className="text-xs text-ink-3">{t("camps.options.hint", { currency })}</p>
        {rows.length === 0 && <p className="text-sm text-ink-3">{t("camps.options.empty")}</p>}
        {rows.map((r) => (
          <OptionRow key={r.key} programId={programId} row={r} editions={data.editions} currency={currency} f={f}
            onRemoveDraft={() => setRows((all) => all.filter((x) => x.key !== r.key))} />
        ))}
      </CardBody>
    </Card>
  );
}

function OptionRow({ programId, row, editions, currency, onRemoveDraft, f }: {
  programId: string; row: OptionDraft; editions: CampEdition[]; currency: string; onRemoveDraft: () => void; f: ReturnType<typeof useFormat>;
}) {
  const t = useT();
  const [v, setV] = React.useState(row);
  const { busy, run, note } = useAction();
  const set = <K extends keyof OptionDraft>(k: K, val: OptionDraft[K]) => setV((s) => ({ ...s, [k]: val }));
  const k = row.key;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(() => savePriceOption(programId, {
      id: v.id, editionId: v.editionId, label: v.label, daysCount: Number(v.daysCount), includesLunch: v.includesLunch,
      price: Number(v.price), currency: "", isActive: v.isActive, sort: Number(v.sort || 0),
    }), t("common.saved"));
  }
  async function remove() {
    if (!v.id) return onRemoveDraft();
    if (!window.confirm(t("camps.options.confirmDelete"))) return;
    await run(() => deleteCampRow(programId, "option", v.id!));
  }
  return (
    <form onSubmit={submit} className="rounded-md border border-line-soft p-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
        <div className="col-span-2 sm:col-span-4"><Label htmlFor={`o-l-${k}`}>{t("camps.options.label")}</Label><Input id={`o-l-${k}`} required maxLength={120} value={v.label} placeholder={t("camps.options.labelPlaceholder")} onChange={(e) => set("label", e.target.value)} /></div>
        <div className="sm:col-span-1"><Label htmlFor={`o-d-${k}`}>{t("camps.options.days")}</Label><Input id={`o-d-${k}`} type="number" min="1" max="63" required value={v.daysCount} onChange={(e) => set("daysCount", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`o-p-${k}`}>{t("camps.options.price", { currency })}</Label><Input id={`o-p-${k}`} type="number" min="0" step="0.01" inputMode="decimal" required value={v.price} onChange={(e) => set("price", e.target.value)} /></div>
        <div className="col-span-2 sm:col-span-3"><Label htmlFor={`o-e-${k}`}>{t("camps.options.edition")}</Label><EditionScopeSelect id={`o-e-${k}`} value={v.editionId} onChange={(x) => set("editionId", x)} editions={editions} /></div>
        <div className="sm:col-span-1"><Label htmlFor={`o-s-${k}`}>{t("camps.sort")}</Label><Input id={`o-s-${k}`} type="number" min="0" value={v.sort} onChange={(e) => set("sort", e.target.value)} /></div>
        <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-12">
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={v.includesLunch} onChange={(e) => set("includesLunch", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" />{t("camps.options.lunch")}</label>
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" />{t("camps.active")}</label>
          {v.price !== "" && <span className="tnum text-xs text-ink-3">{f.money(Number(v.price), currency)}</span>}
          <span className="flex-1" />
          <RowActions busy={busy} onDelete={remove} isNew={!v.id} />
        </div>
      </div>
      {note}
    </form>
  );
}

type GroupDraft = { key: string; id: string | null; label: string; minAge: string; maxAge: string; timeSlotId: string; isActive: boolean; sort: string };

function AgeGroupsSection({ programId, data }: { programId: string; data: CampAdminData }) {
  const t = useT();
  const initial = React.useMemo<GroupDraft[]>(() => data.ageGroups.map((g) => ({
    key: g.id, id: g.id, label: g.label, minAge: g.minAge != null ? String(g.minAge) : "", maxAge: g.maxAge != null ? String(g.maxAge) : "",
    timeSlotId: g.timeSlotId ?? "", isActive: g.isActive, sort: String(g.sort),
  })), [data.ageGroups]);
  const [rows, setRows] = React.useState(initial);
  React.useEffect(() => setRows(initial), [initial]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("camps.ageGroups.title")}</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setRows((r) => [...r, { key: `new-${Date.now()}`, id: null, label: "", minAge: "", maxAge: "", timeSlotId: "", isActive: true, sort: String((r.length + 1) * 10) }])}><Plus className="h-4 w-4" /> {t("camps.ageGroups.add")}</Button>
      </CardHeader>
      <CardBody className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-ink-3">{t("camps.ageGroups.empty")}</p>}
        {rows.map((r) => <GroupRow key={r.key} programId={programId} row={r} slots={data.timeSlots} onRemoveDraft={() => setRows((all) => all.filter((x) => x.key !== r.key))} />)}
      </CardBody>
    </Card>
  );
}

function GroupRow({ programId, row, slots, onRemoveDraft }: { programId: string; row: GroupDraft; slots: CampAdminData["timeSlots"]; onRemoveDraft: () => void }) {
  const t = useT();
  const [v, setV] = React.useState(row);
  const { busy, run, note } = useAction();
  const set = <K extends keyof GroupDraft>(k: K, val: GroupDraft[K]) => setV((s) => ({ ...s, [k]: val }));
  const k = row.key;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(() => saveAgeGroup(programId, { id: v.id, label: v.label, minAge: opt(v.minAge), maxAge: opt(v.maxAge), timeSlotId: v.timeSlotId, isActive: v.isActive, sort: Number(v.sort || 0) }), t("common.saved"));
  }
  async function remove() {
    if (!v.id) return onRemoveDraft();
    if (!window.confirm(t("camps.ageGroups.confirmDelete"))) return;
    await run(() => deleteCampRow(programId, "ageGroup", v.id!));
  }
  return (
    <form onSubmit={submit} className="rounded-md border border-line-soft p-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
        <div className="col-span-2 sm:col-span-3"><Label htmlFor={`g-l-${k}`}>{t("camps.ageGroups.label")}</Label><Input id={`g-l-${k}`} required maxLength={80} value={v.label} placeholder={t("camps.ageGroups.labelPlaceholder")} onChange={(e) => set("label", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`g-min-${k}`}>{t("camps.ageGroups.minAge")}</Label><Input id={`g-min-${k}`} type="number" min="0" max="99" value={v.minAge} onChange={(e) => set("minAge", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`g-max-${k}`}>{t("camps.ageGroups.maxAge")}</Label><Input id={`g-max-${k}`} type="number" min="0" max="99" value={v.maxAge} onChange={(e) => set("maxAge", e.target.value)} /></div>
        <div className="col-span-2 sm:col-span-3"><Label htmlFor={`g-s-${k}`}>{t("camps.ageGroups.timeSlot")}</Label>
          <Select id={`g-s-${k}`} value={v.timeSlotId} onChange={(e) => set("timeSlotId", e.target.value)}>
            <option value="">{t("camps.ageGroups.anySlot")}</option>
            {slots.map((s) => <option key={s.id} value={s.id}>{`${s.label} · ${s.startsAt}–${s.endsAt}`}</option>)}
          </Select>
        </div>
        <div className="sm:col-span-2"><Label htmlFor={`g-o-${k}`}>{t("camps.sort")}</Label><Input id={`g-o-${k}`} type="number" min="0" value={v.sort} onChange={(e) => set("sort", e.target.value)} /></div>
        <div className="col-span-2 flex items-center gap-3 sm:col-span-12">
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" />{t("camps.active")}</label>
          <span className="flex-1" />
          <RowActions busy={busy} onDelete={remove} isNew={!v.id} />
        </div>
      </div>
      {note}
    </form>
  );
}

type SlotDraft = { key: string; id: string | null; editionId: string; label: string; startsAt: string; endsAt: string; sort: string };

function TimeSlotsSection({ programId, data }: { programId: string; data: CampAdminData }) {
  const t = useT();
  const initial = React.useMemo<SlotDraft[]>(() => data.timeSlots.map((s) => ({
    key: s.id, id: s.id, editionId: s.editionId ?? "", label: s.label, startsAt: s.startsAt, endsAt: s.endsAt, sort: String(s.sort),
  })), [data.timeSlots]);
  const [rows, setRows] = React.useState(initial);
  React.useEffect(() => setRows(initial), [initial]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("camps.slots.title")}</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setRows((r) => [...r, { key: `new-${Date.now()}`, id: null, editionId: "", label: "", startsAt: "09:00", endsAt: "12:00", sort: String((r.length + 1) * 10) }])}><Plus className="h-4 w-4" /> {t("camps.slots.add")}</Button>
      </CardHeader>
      <CardBody className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-ink-3">{t("camps.slots.empty")}</p>}
        {rows.map((r) => <SlotRow key={r.key} programId={programId} row={r} editions={data.editions} onRemoveDraft={() => setRows((all) => all.filter((x) => x.key !== r.key))} />)}
      </CardBody>
    </Card>
  );
}

function SlotRow({ programId, row, editions, onRemoveDraft }: { programId: string; row: SlotDraft; editions: CampEdition[]; onRemoveDraft: () => void }) {
  const t = useT();
  const [v, setV] = React.useState(row);
  const { busy, run, note } = useAction();
  const set = <K extends keyof SlotDraft>(k: K, val: SlotDraft[K]) => setV((s) => ({ ...s, [k]: val }));
  const k = row.key;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(() => saveTimeSlot(programId, { id: v.id, editionId: v.editionId, label: v.label, startsAt: v.startsAt, endsAt: v.endsAt, sort: Number(v.sort || 0) }), t("common.saved"));
  }
  async function remove() {
    if (!v.id) return onRemoveDraft();
    if (!window.confirm(t("camps.slots.confirmDelete"))) return;
    await run(() => deleteCampRow(programId, "timeSlot", v.id!));
  }
  return (
    <form onSubmit={submit} className="rounded-md border border-line-soft p-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
        <div className="col-span-2 sm:col-span-3"><Label htmlFor={`s-l-${k}`}>{t("camps.slots.label")}</Label><Input id={`s-l-${k}`} required maxLength={80} value={v.label} placeholder={t("camps.slots.labelPlaceholder")} onChange={(e) => set("label", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`s-a-${k}`}>{t("camps.slots.start")}</Label><Input id={`s-a-${k}`} type="time" step={300} required value={v.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`s-b-${k}`}>{t("camps.slots.end")}</Label><Input id={`s-b-${k}`} type="time" step={300} required value={v.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></div>
        <div className="col-span-2 sm:col-span-3"><Label htmlFor={`s-e-${k}`}>{t("camps.options.edition")}</Label><EditionScopeSelect id={`s-e-${k}`} value={v.editionId} onChange={(x) => set("editionId", x)} editions={editions} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`s-o-${k}`}>{t("camps.sort")}</Label><Input id={`s-o-${k}`} type="number" min="0" value={v.sort} onChange={(e) => set("sort", e.target.value)} /></div>
        <div className="col-span-2 flex justify-end sm:col-span-12"><RowActions busy={busy} onDelete={remove} isNew={!v.id} /></div>
      </div>
      {note}
    </form>
  );
}

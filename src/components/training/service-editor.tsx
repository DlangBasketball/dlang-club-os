"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, FieldHint, Input, Label } from "@/components/ui";
import { Select, Textarea } from "@/components/teams/fields";
import { saveServicePackages, saveTrainingService } from "@/lib/actions/training";
import { useFormat, useT } from "@/lib/i18n/client";
import { currencySymbol } from "@/lib/format";
import { packageSavings, perSessionPrice } from "@/lib/training/pricing";
import { COLOR_PICKER_FALLBACK, SERVICE_CURRENCIES } from "@/lib/training/validation";
import type { TrainingCoach, TrainingPackage, TrainingService, TrainingVenue } from "@/lib/training/data";
import { venueLine } from "./slot-picker";

/** Edit a training type: name, type + participants, duration, location, price, currency, coaches, colour, active. */
export function ServiceEditor({ service, venues, coaches }: { service?: TrainingService; venues: TrainingVenue[]; coaches: TrainingCoach[] }) {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const [f, setF] = React.useState({
    name: service?.name ?? "", description: service?.description ?? "", sessionType: service?.sessionType ?? "individual",
    maxParticipants: String(service?.maxParticipants ?? 1), minParticipants: String(service?.minParticipants ?? 1),
    durationMin: String(service?.durationMin ?? 60), price: String(service?.price ?? 0), currency: service?.currency ?? "",
    venueId: service?.venueId ?? "", locationText: service?.locationText ?? "", color: service?.color ?? "",
    coachIds: service?.coachIds ?? [], isActive: service?.isActive ?? true, sortOrder: String(service?.sortOrder ?? 0),
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const cur = f.currency || fmt.currency;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (service?.isActive && !f.isActive && !window.confirm(t("training.service.confirmDeactivate"))) return;
    setPending(true); setErr(null); setMsg(null);
    const res = await saveTrainingService(service?.id ?? null, {
      name: f.name, description: f.description, sessionType: f.sessionType as "individual" | "group",
      maxParticipants: Number(f.maxParticipants), minParticipants: Number(f.minParticipants), durationMin: Number(f.durationMin),
      price: Number(f.price), currency: f.currency as "" | (typeof SERVICE_CURRENCIES)[number], venueId: f.venueId || null,
      locationText: f.locationText, color: f.color, coachIds: f.coachIds, isActive: f.isActive, sortOrder: Number(f.sortOrder),
      creditCategory: service?.creditCategory ?? "personal", creditsRequired: service?.creditsRequired ?? 0,
    });
    setPending(false);
    if (!res.ok) { setErr(res.error); return; }
    if (service) { setMsg(t("training.common.saved")); router.refresh(); } else router.push(`/admin/services/${res.data!.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div><Label htmlFor="sv-name">{t("training.service.name")}</Label><Input id="sv-name" required maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
      <div><Label htmlFor="sv-desc">{t("training.service.description")}</Label><Textarea id="sv-desc" maxLength={2000} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="sv-type">{t("training.service.type")}</Label>
          <Select id="sv-type" value={f.sessionType} onChange={(e) => { const v = e.target.value as "individual" | "group"; setF((s) => ({ ...s, sessionType: v, maxParticipants: v === "group" ? (Number(s.maxParticipants) > 1 ? s.maxParticipants : "6") : "1", minParticipants: v === "group" ? s.minParticipants : "1" })); }}>
            <option value="individual">{t("training.common.individual")}</option>
            <option value="group">{t("training.common.group")}</option>
          </Select>
        </div>
        {f.sessionType === "group" && <>
          <div><Label htmlFor="sv-min">{t("training.service.minParticipants")}</Label><Input id="sv-min" type="number" min={1} max={100} value={f.minParticipants} onChange={(e) => set("minParticipants", e.target.value)} /></div>
          <div><Label htmlFor="sv-max">{t("training.service.maxParticipants")}</Label><Input id="sv-max" type="number" min={1} max={100} value={f.maxParticipants} onChange={(e) => set("maxParticipants", e.target.value)} /></div>
        </>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div><Label htmlFor="sv-dur">{t("training.service.duration")}</Label><Input id="sv-dur" type="number" min={15} max={480} step={5} value={f.durationMin} onChange={(e) => set("durationMin", e.target.value)} /></div>
        <div>
          <Label htmlFor="sv-price">{f.sessionType === "group" ? t("training.service.pricePerPerson", { currency: currencySymbol(cur, fmt.locale) }) : t("training.service.price", { currency: currencySymbol(cur, fmt.locale) })}</Label>
          <Input id="sv-price" type="number" min={0} step="0.01" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sv-cur">{t("training.service.currency")}</Label>
          <Select id="sv-cur" value={f.currency} onChange={(e) => set("currency", e.target.value)}>
            <option value="">{t("training.service.clubCurrency", { currency: fmt.currency })}</option>
            {SERVICE_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="sv-venue">{t("training.service.venue")}</Label>
          <Select id="sv-venue" value={f.venueId} onChange={(e) => set("venueId", e.target.value)}>
            <option value="">{t("training.service.noVenue")}</option>
            {venues.filter((v) => v.isActive || v.id === f.venueId).map((v) => <option key={v.id} value={v.id}>{venueLine(v)}</option>)}
          </Select>
          <FieldHint>{t("training.service.venueHint")}</FieldHint>
        </div>
        <div><Label htmlFor="sv-loc">{t("training.service.locationText")}</Label><Input id="sv-loc" maxLength={300} value={f.locationText} onChange={(e) => set("locationText", e.target.value)} placeholder={t("training.service.locationPlaceholder")} /></div>
      </div>
      <fieldset>
        <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("training.service.coaches")}</legend>
        <div className="flex flex-wrap gap-2">
          {coaches.filter((c) => c.isActive).map((c) => (
            <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${f.coachIds.includes(c.id) ? "border-maroon bg-maroon/10 text-ink" : "border-line text-ink-3"}`}>
              <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--red-primary)]" checked={f.coachIds.includes(c.id)}
                onChange={(e) => set("coachIds", e.target.checked ? [...f.coachIds, c.id] : f.coachIds.filter((x) => x !== c.id))} />
              {c.name}
            </label>
          ))}
        </div>
        <FieldHint>{t("training.service.coachesHint")}</FieldHint>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="sv-color">{t("training.service.color")}</Label>
          <div className="flex items-center gap-2">
            <input id="sv-color" type="color" value={f.color || COLOR_PICKER_FALLBACK} onChange={(e) => set("color", e.target.value)} className="h-10 w-14 rounded border border-line bg-surface-input" />
            {f.color && <Button type="button" size="sm" variant="ghost" onClick={() => set("color", "")}>{t("training.service.noColor")}</Button>}
          </div>
        </div>
        <div><Label htmlFor="sv-sort">{t("training.service.sortOrder")}</Label><Input id="sv-sort" type="number" value={f.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} /></div>
        <label className="flex items-center gap-2 pt-6 text-sm text-ink-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("training.service.active")}</label>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {msg && <p role="status" className="text-sm text-success">{msg}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? t("common.saving") : service ? t("common.save") : t("common.create")}</Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => router.push("/admin/services")}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

type Row = { key: string; id: string | null; name: string; sessions: string; price: string; validityDays: string; isActive: boolean };

/** Any number of session packages per service (sessions, price, validity, active, order). */
export function PackagesEditor({ serviceId, packages, singlePrice, currency }: { serviceId: string; packages: TrainingPackage[]; singlePrice: number; currency: string | null }) {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const cur = currency ?? fmt.currency;
  const toRows = (ps: TrainingPackage[]): Row[] => ps.map((p) => ({ key: p.id, id: p.id, name: p.name, sessions: String(p.sessions), price: String(p.price), validityDays: p.validityDays ? String(p.validityDays) : "", isActive: p.isActive }));
  const [rows, setRows] = React.useState<Row[]>(toRows(packages));
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => { const n = [...rs]; const j = i + d; if (j < 0 || j >= n.length) return rs; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function save() {
    setPending(true); setErr(null); setMsg(null);
    const res = await saveServicePackages(serviceId, rows.map((r, i) => ({
      id: r.id, name: r.name, sessions: Number(r.sessions), price: Number(r.price), validityDays: r.validityDays === "" ? null : Number(r.validityDays), isActive: r.isActive, sortOrder: i + 1,
    })));
    setPending(false);
    if (!res.ok) { setErr(res.error); return; }
    setMsg(t("training.common.saved"));
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-3">{t("training.packages.hint", { price: fmt.money(singlePrice, cur) })}</p>
      {rows.length === 0 && <p className="text-sm text-ink-4">{t("training.packages.empty")}</p>}
      <div className="space-y-2">
        {rows.map((r, i) => {
          const p = { sessions: Number(r.sessions) || 0, price: Number(r.price) || 0 };
          const save = packageSavings(p, singlePrice, cur);
          return (
            <div key={r.key} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1.4fr_0.7fr_0.9fr_0.8fr_auto_auto]">
              <div className="col-span-2 sm:col-span-1"><Label htmlFor={`pk-n-${r.key}`}>{t("training.packages.name")}</Label><Input id={`pk-n-${r.key}`} value={r.name} placeholder={t("training.packages.defaultName", { count: p.sessions })} onChange={(e) => update(r.key, { name: e.target.value })} /></div>
              <div><Label htmlFor={`pk-s-${r.key}`}>{t("training.packages.sessions")}</Label><Input id={`pk-s-${r.key}`} type="number" min={1} max={1000} value={r.sessions} onChange={(e) => update(r.key, { sessions: e.target.value })} /></div>
              <div><Label htmlFor={`pk-p-${r.key}`}>{t("training.packages.price", { currency: currencySymbol(cur, fmt.locale) })}</Label><Input id={`pk-p-${r.key}`} type="number" min={0} step="0.01" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} /></div>
              <div><Label htmlFor={`pk-v-${r.key}`}>{t("training.packages.validity")}</Label><Input id={`pk-v-${r.key}`} type="number" min={1} max={3650} value={r.validityDays} placeholder={t("training.packages.noExpiry")} onChange={(e) => update(r.key, { validityDays: e.target.value })} /></div>
              <label className="flex items-center gap-1.5 pb-2 text-xs text-ink-2"><input type="checkbox" checked={r.isActive} onChange={(e) => update(r.key, { isActive: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("training.packages.active")}</label>
              <div className="flex items-center gap-1 pb-1">
                <Button type="button" size="sm" variant="ghost" aria-label={t("training.packages.moveUp")} onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
                <Button type="button" size="sm" variant="ghost" aria-label={t("training.packages.moveDown")} onClick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</Button>
                <Button type="button" size="sm" variant="ghost" aria-label={t("training.packages.remove")} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <p className="col-span-2 text-[11px] text-ink-4 sm:col-span-6">
                {p.sessions > 0 && t("training.common.perSession", { price: fmt.money(perSessionPrice(p, cur), cur) })}
                {save.percent > 0 && ` · ${t("training.common.save", { percent: save.percent })}`}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setRows((rs) => [...rs, { key: `new-${Date.now()}`, id: null, name: "", sessions: "5", price: "", validityDays: "", isActive: true }])}>
          <Plus className="h-4 w-4" /> {t("training.packages.add")}
        </Button>
        <Button type="button" size="sm" disabled={pending} onClick={save}>{pending ? t("common.saving") : t("training.packages.save")}</Button>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {msg && <p role="status" className="text-sm text-success">{msg}</p>}
    </div>
  );
}

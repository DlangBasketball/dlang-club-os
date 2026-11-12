"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { createProgram, updateProgram } from "@/lib/actions/programs";
import { PROGRAM_CURRENCIES, PROGRAM_STATUSES, zonedParts, type ProgramInput, type ProgramStatus } from "@/lib/club-ops/validation";
import { useFormat, useT } from "@/lib/i18n/client";
import { zonedWallTimeToUtc } from "@/lib/format";

type Kind = ProgramInput["kind"];

export type ProgramFormInitial = {
  name: string; kind: Kind; status: ProgramStatus; description: string; scheduleSummary: string; location: string;
  startsOn: string; endsOn: string; price: number; currency: string; capacity: number | null; minAge: number | null; maxAge: number | null;
  registrationOpensAt: string | null; registrationClosesAt: string | null; isPublic: boolean;
};

/** datetime-local value ("YYYY-MM-DDTHH:mm") in the club's time zone. */
function toLocalInput(iso: string | null, tz: string): string {
  const p = zonedParts(iso, tz);
  return p.date ? `${p.date}T${p.time}` : "";
}
function fromLocalInput(v: string, tz: string): string {
  if (!v) return "";
  const [d, t] = v.split("T");
  return zonedWallTimeToUtc(d, t ?? "00:00", tz)?.toISOString() ?? "";
}

export function ProgramForm({ kinds, currencyLabel, programId, initial }: {
  kinds: { value: Kind; label: string }[];
  currencyLabel: string;
  programId?: string;
  initial?: ProgramFormInitial;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [v, setV] = React.useState({
    name: initial?.name ?? "",
    kind: initial?.kind ?? kinds[0]?.value ?? "camp",
    status: initial?.status ?? ("published" as ProgramStatus),
    description: initial?.description ?? "",
    scheduleSummary: initial?.scheduleSummary ?? "",
    location: initial?.location ?? "",
    startsOn: initial?.startsOn ?? "",
    endsOn: initial?.endsOn ?? "",
    price: String(initial?.price ?? 0),
    currency: initial?.currency ?? "",
    capacity: initial?.capacity != null ? String(initial.capacity) : "",
    minAge: initial?.minAge != null ? String(initial.minAge) : "",
    maxAge: initial?.maxAge != null ? String(initial.maxAge) : "",
    opensAt: toLocalInput(initial?.registrationOpensAt ?? null, f.timeZone),
    closesAt: toLocalInput(initial?.registrationClosesAt ?? null, f.timeZone),
    isPublic: initial?.isPublic ?? false,
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => { setSaved(false); setV((s) => ({ ...s, [k]: val })); };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const input: ProgramInput = {
      name: v.name, kind: v.kind as Kind, status: v.status, description: v.description, scheduleSummary: v.scheduleSummary,
      location: v.location, startsOn: v.startsOn, endsOn: v.endsOn, price: v.price === "" ? 0 : Number(v.price),
      currency: v.currency as ProgramInput["currency"], capacity: v.capacity === "" ? "" : Number(v.capacity),
      minAge: v.minAge === "" ? "" : Number(v.minAge), maxAge: v.maxAge === "" ? "" : Number(v.maxAge),
      registrationOpensAt: fromLocalInput(v.opensAt, f.timeZone), registrationClosesAt: fromLocalInput(v.closesAt, f.timeZone),
      isPublic: v.isPublic,
    };
    startTransition(async () => {
      const res = programId ? await updateProgram(programId, input) : await createProgram(input);
      // createProgram redirects on success; only errors come back.
      if (res && !res.ok) { setErr(res.error); return; }
      if (programId) { setSaved(true); router.push(`/admin/programs/${programId}`); router.refresh(); }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div><Label htmlFor="p-name">{t("common.name")}</Label><Input id="p-name" required maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} /></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor="p-kind">{t("editOps.programs.kind")}</Label>
          <Select id="p-kind" value={v.kind} onChange={(e) => set("kind", e.target.value as Kind)}>
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="p-status">{t("common.status")}</Label>
          <Select id="p-status" value={v.status} onChange={(e) => set("status", e.target.value as ProgramStatus)}>
            {PROGRAM_STATUSES.map((s) => <option key={s} value={s}>{t.dynamic(`editOps.programs.statuses.${s}`, undefined, s)}</option>)}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div><Label htmlFor="p-price">{t("editOps.programs.price")}</Label><Input id="p-price" type="number" min="0" step="0.01" inputMode="decimal" value={v.price} onChange={(e) => set("price", e.target.value)} /></div>
        <div><Label htmlFor="p-cur">{t("editOps.programs.currency")}</Label>
          <Select id="p-cur" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
            <option value="">{t("editOps.programs.clubCurrency", { currency: currencyLabel })}</option>
            {PROGRAM_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="p-cap">{t("editOps.programs.capacity")}</Label><Input id="p-cap" type="number" min="1" step="1" value={v.capacity} onChange={(e) => set("capacity", e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor="p-start">{t("editOps.programs.startsOn")}</Label><Input id="p-start" type="date" value={v.startsOn} onChange={(e) => set("startsOn", e.target.value)} /></div>
        <div><Label htmlFor="p-end">{t("editOps.programs.endsOn")}</Label><Input id="p-end" type="date" value={v.endsOn} onChange={(e) => set("endsOn", e.target.value)} /></div>
        <div><Label htmlFor="p-min">{t("editOps.programs.minAge")}</Label><Input id="p-min" type="number" min="0" max="99" step="1" value={v.minAge} onChange={(e) => set("minAge", e.target.value)} /></div>
        <div><Label htmlFor="p-max">{t("editOps.programs.maxAge")}</Label><Input id="p-max" type="number" min="0" max="99" step="1" value={v.maxAge} onChange={(e) => set("maxAge", e.target.value)} /></div>
        <div><Label htmlFor="p-open">{t("editOps.programs.registrationOpens")}</Label><Input id="p-open" type="datetime-local" value={v.opensAt} onChange={(e) => set("opensAt", e.target.value)} /></div>
        <div><Label htmlFor="p-close">{t("editOps.programs.registrationCloses")}</Label><Input id="p-close" type="datetime-local" value={v.closesAt} onChange={(e) => set("closesAt", e.target.value)} /></div>
      </div>
      <div><Label htmlFor="p-sched">{t("editOps.programs.schedule")}</Label><Input id="p-sched" maxLength={500} value={v.scheduleSummary} placeholder={t("editOps.programs.schedulePlaceholder")} onChange={(e) => set("scheduleSummary", e.target.value)} /></div>
      <div><Label htmlFor="p-loc">{t("editOps.programs.location")}</Label><Input id="p-loc" maxLength={200} value={v.location} onChange={(e) => set("location", e.target.value)} /></div>
      <div><Label htmlFor="p-desc">{t("editOps.programs.description")}</Label><Textarea id="p-desc" maxLength={4000} value={v.description} onChange={(e) => set("description", e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={v.isPublic} onChange={(e) => set("isPublic", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("editOps.programs.publicToggle")}
      </label>
      <p className="text-xs text-ink-3">{t("editOps.programs.publicHint")}</p>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {saved && <p role="status" className="text-sm text-success">{t("common.saved")}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? t("common.saving") : programId ? t("common.save") : t("common.create")}</Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => router.push(programId ? `/admin/programs/${programId}` : "/admin/programs")}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

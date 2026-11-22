"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import type { TournamentView } from "@/lib/selection/roster";
import { deleteTournament, repairRosterRegistration, saveTournament, setCoachPaymentBadge, setPaymentPeriod } from "@/lib/actions/selection-roster";

const EMPTY = { name: "", divisionId: "", stage: "", city: "", location: "", startsOn: "", endsOn: "", sort: "0", status: "planned" };
const STATUSES = ["planned", "confirmed", "completed", "cancelled"] as const;

/** Tournament schedule of a programme (admin): name, stage, city, dates, age group. */
export function TournamentsEditor({ programId, tournaments, divisions }: {
  programId: string; tournaments: TournamentView[]; divisions: { id: string; label: string }[];
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const id = React.useId();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  function edit(x: TournamentView | null) {
    setError(null);
    setMessage(null);
    setEditing(x ? x.id : "new");
    setForm(x ? {
      name: x.name, divisionId: x.divisionId ?? "", stage: x.stage ?? "", city: x.city ?? "", location: x.location ?? "",
      startsOn: x.startsOn ?? "", endsOn: x.endsOn ?? "", sort: String(x.sort), status: x.status,
    } : EMPTY);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await saveTournament(programId, editing === "new" ? null : editing, { ...form, sort: Number(form.sort) || 0, status: form.status as (typeof STATUSES)[number] });
    setPending(false);
    if (!res.ok) { setError(res.error); return; }
    setEditing(null);
    setMessage(res.message ?? null);
    router.refresh();
  }
  async function remove(x: TournamentView) {
    if (!window.confirm(t("roster.tournaments.confirmDelete", { name: x.name }))) return;
    const res = await deleteTournament(programId, x.id);
    if (!res.ok) setError(res.error); else { setMessage(res.message ?? null); router.refresh(); }
  }
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const divisionLabel = (d: string | null) => (d ? divisions.find((x) => x.id === d)?.label ?? "—" : t("roster.tournaments.allDivisions"));

  return (
    <div id="tournaments" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg text-text">{t("roster.tournaments.title")}</h3>
          <p className="text-xs text-text-muted">{t("roster.tournaments.hint")}</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => edit(null)}><Plus className="h-4 w-4" /> {t("roster.tournaments.add")}</Button>
      </div>
      {tournaments.length === 0 && editing === null && <p className="text-sm text-text-muted">{t("roster.tournaments.empty")}</p>}
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        {tournaments.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span>
              <span className="font-medium text-text">{x.name}</span>{x.stage ? ` · ${x.stage}` : ""}
              <span className="block text-xs text-text-muted">
                {divisionLabel(x.divisionId)} · {[x.city, x.location].filter(Boolean).join(", ") || "—"} · {x.startsOn ? f.dateRange(x.startsOn, x.endsOn ?? x.startsOn) : t("roster.form.datesTbc")}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <Badge tone={x.status === "cancelled" ? "neutral" : x.status === "confirmed" ? "success" : "info"}>{t(`roster.tournaments.statuses.${x.status}`)}</Badge>
              <Button type="button" size="sm" variant="ghost" aria-label={t("common.edit")} onClick={() => edit(x)}><Pencil className="h-4 w-4" /></Button>
              <Button type="button" size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => void remove(x)}><Trash2 className="h-4 w-4" /></Button>
            </span>
          </li>
        ))}
      </ul>
      {editing !== null && (
        <form onSubmit={save} className="space-y-3 rounded-md border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor={`${id}-name`}>{t("roster.tournaments.name")}</Label><Input id={`${id}-name`} required maxLength={120} value={form.name} onChange={set("name")} /></div>
            <div><Label htmlFor={`${id}-stage`}>{t("roster.tournaments.stage")}</Label><Input id={`${id}-stage`} maxLength={80} value={form.stage} onChange={set("stage")} /></div>
            <div><Label htmlFor={`${id}-div`}>{t("roster.tournaments.division")}</Label>
              <Select id={`${id}-div`} value={form.divisionId} onChange={set("divisionId")}>
                <option value="">{t("roster.tournaments.allDivisions")}</option>
                {divisions.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </Select></div>
            <div><Label htmlFor={`${id}-city`}>{t("roster.tournaments.city")}</Label><Input id={`${id}-city`} maxLength={120} value={form.city} onChange={set("city")} /></div>
            <div><Label htmlFor={`${id}-loc`}>{t("roster.tournaments.location")}</Label><Input id={`${id}-loc`} maxLength={160} value={form.location} onChange={set("location")} /></div>
            <div><Label htmlFor={`${id}-status`}>{t("roster.tournaments.status")}</Label>
              <Select id={`${id}-status`} value={form.status} onChange={set("status")}>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`roster.tournaments.statuses.${s}`)}</option>)}
              </Select></div>
            <div><Label htmlFor={`${id}-from`}>{t("roster.tournaments.startsOn")}</Label><Input id={`${id}-from`} type="date" value={form.startsOn} onChange={set("startsOn")} /></div>
            <div><Label htmlFor={`${id}-to`}>{t("roster.tournaments.endsOn")}</Label><Input id={`${id}-to`} type="date" value={form.endsOn} onChange={set("endsOn")} /></div>
            <div><Label htmlFor={`${id}-sort`}>{t("roster.tournaments.sort")}</Label><Input id={`${id}-sort`} inputMode="numeric" value={form.sort} onChange={set("sort")} /></div>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>{t("common.save")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          </div>
        </form>
      )}
      {editing === null && error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {message && <p role="status" className="text-sm text-success">{message}</p>}
    </div>
  );
}

/** Programme setting: coaches see the payment status badge (never amounts). */
export function CoachPaymentBadgeToggle({ programId, value }: { programId: string; value: boolean }) {
  const t = useT();
  const router = useRouter();
  const [on, setOn] = React.useState(value);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={on} onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          const res = await setCoachPaymentBadge(programId, next);
          if (!res.ok) { setOn(!next); setError(res.error); } else router.refresh();
        }} />
        {t("roster.settings.coachBadge")}
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** Programme payment period: monthly plans start here by default and must end by the end date. */
export function PaymentPeriodEditor({ programId, startsOn, endsOn }: { programId: string; startsOn: string | null; endsOn: string | null }) {
  const t = useT();
  const router = useRouter();
  const id = React.useId();
  const [from, setFrom] = React.useState(startsOn ?? "");
  const [to, setTo] = React.useState(endsOn ?? "");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-2 rounded-md border border-border p-4">
      <h3 className="text-sm font-medium text-text">{t("roster.settings.paymentPeriod")}</h3>
      <p className="text-xs text-text-muted">{t("roster.settings.paymentPeriodHint")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor={`${id}-from`}>{t("roster.settings.paymentStarts")}</Label>
          <Input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor={`${id}-to`}>{t("roster.settings.paymentEnds")}</Label>
          <Input id={`${id}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button type="button" variant="secondary" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          const res = await setPaymentPeriod(programId, from || null, to || null);
          setBusy(false);
          if (!res.ok) setMsg({ ok: false, text: res.error }); else { setMsg({ ok: true, text: res.message ?? "" }); router.refresh(); }
        }}>{t("common.save")}</Button>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}

/** Staff notice: enrolled players without a programme registration (never silent). */
export function RosterHealthNotice({ missing, recentFailures, canRepair }: {
  missing: { applicationId: string; athlete: string }[]; recentFailures: number; canRepair: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (!missing.length && !recentFailures) return null;
  return (
    <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning-soft p-4 text-sm text-text">
      <p className="font-medium">{t("roster.health.title")}</p>
      {missing.length > 0 ? <p>{t("roster.health.missing", { count: missing.length })}</p> : <p>{t("roster.health.failures", { count: recentFailures })}</p>}
      {missing.length > 0 && (
        <ul className="space-y-1">
          {missing.slice(0, 20).map((m) => (
            <li key={m.applicationId} className="flex items-center gap-2">
              <span>{m.athlete}</span>
              {canRepair && (
                <Button type="button" size="sm" variant="ghost" disabled={busy === m.applicationId} onClick={async () => {
                  setBusy(m.applicationId);
                  const res = await repairRosterRegistration(m.applicationId);
                  setBusy(null);
                  if (!res.ok) setError(res.error); else router.refresh();
                }}><Wrench className="h-4 w-4" /> {t("roster.health.repair")}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

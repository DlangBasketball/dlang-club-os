"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { MONTHS } from "@/lib/billing/activities";
import { clubSeasonBounds } from "@/lib/membership/schedule";
import { saveClubBillingSettings, saveSeason, setCurrentSeason } from "@/lib/actions/billing";
import type { ClubBillingSettings, Season } from "@/lib/data/billing";

type Msg = { ok: boolean; text: string } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <span role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>;
}

function useMonthNames(): string[] {
  const f = useFormat();
  return React.useMemo(() => {
    const fmt = new Intl.DateTimeFormat(f.locale, { month: "long", timeZone: "UTC" });
    return MONTHS.map((m) => fmt.format(Date.UTC(2026, m - 1, 15)));
  }, [f.locale]);
}

function DefaultsForm({ settings, canEdit }: { settings: ClubBillingSettings; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const months = useMonthNames();
  const [start, setStart] = React.useState(settings.seasonStartMonth);
  const [count, setCount] = React.useState(settings.installmentCount);
  const [day, setDay] = React.useState(settings.installmentDueDay);
  const [first, setFirst] = React.useState<number | null>(settings.firstInstallmentMonthSet ? settings.firstInstallmentMonth : null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await saveClubBillingSettings({ seasonStartMonth: start, installmentCount: count, installmentDueDay: day, firstInstallmentMonth: first });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? t("billing.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("billing.seasons.defaultsTitle")}</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-ink-3">{t("billing.seasons.defaultsHint")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="season-start">{t("billing.seasons.seasonStartMonth")}</Label>
              <Select id="season-start" disabled={!canEdit} value={start} onChange={(e) => setStart(Number(e.target.value))}>
                {MONTHS.map((m) => <option key={m} value={m}>{months[m - 1]}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="first-month">{t("billing.seasons.firstInstallmentMonth")}</Label>
              <Select id="first-month" disabled={!canEdit} value={first ?? ""} onChange={(e) => setFirst(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{t("billing.seasons.sameAsSeasonStart")}</option>
                {MONTHS.map((m) => <option key={m} value={m}>{months[m - 1]}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="inst-count">{t("billing.seasons.installmentCount")}</Label>
              <Input id="inst-count" type="number" min={1} max={12} disabled={!canEdit} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="due-day">{t("billing.seasons.dueDay")}</Label>
              <Input id="due-day" type="number" min={1} max={31} disabled={!canEdit} value={day} onChange={(e) => setDay(Number(e.target.value))} />
            </div>
          </div>
          {canEdit && (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
              <Status msg={msg} />
            </div>
          )}
        </form>
      </CardBody>
    </Card>
  );
}

export function SeasonsEditor({ settings, seasons, canEdit }: { settings: ClubBillingSettings; seasons: Season[]; canEdit: boolean }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const next = clubSeasonBounds(today, settings.seasonStartMonth);
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [form, setForm] = React.useState({ name: "", startsOn: "", endsOn: "", trainingStartsOn: "", trainingEndsOn: "" });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);

  function open(s: Season | null) {
    setMsg(null);
    if (s) {
      setForm({ name: s.name, startsOn: s.startsOn, endsOn: s.endsOn, trainingStartsOn: s.trainingStartsOn ?? "", trainingEndsOn: s.trainingEndsOn ?? "" });
      setEditing(s.id);
    } else {
      const startYear = next ? Number(next.startsOn.slice(0, 4)) : new Date().getFullYear();
      setForm({ name: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`, startsOn: next?.startsOn ?? "", endsOn: next?.endsOn ?? "", trainingStartsOn: "", trainingEndsOn: "" });
      setEditing("new");
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await saveSeason({
      id: editing === "new" ? null : editing, name: form.name, startsOn: form.startsOn, endsOn: form.endsOn,
      trainingStartsOn: form.trainingStartsOn || null, trainingEndsOn: form.trainingEndsOn || null,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setEditing(null);
    setMsg({ ok: true, text: res.message ?? t("billing.saved") });
    router.refresh();
  }
  async function makeCurrent(id: string) {
    setMsg(null);
    const res = await setCurrentSeason(id);
    setMsg(res.ok ? { ok: true, text: res.message ?? t("billing.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  const seasonForm = (
    <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_10rem_10rem_auto]" onSubmit={submit}>
      <div><Label htmlFor="s-name">{t("billing.seasons.name")}</Label><Input id="s-name" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div><Label htmlFor="s-start">{t("billing.seasons.startsOn")}</Label><Input id="s-start" type="date" required value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></div>
      <div><Label htmlFor="s-end">{t("billing.seasons.endsOn")}</Label><Input id="s-end" type="date" required value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></div>
      <div className="hidden sm:block" />
      <div className="sm:col-start-2"><Label htmlFor="s-tstart">{t("teamAttendance.seasons.trainingStartsOn")}</Label><Input id="s-tstart" type="date" value={form.trainingStartsOn} onChange={(e) => setForm({ ...form, trainingStartsOn: e.target.value })} /></div>
      <div><Label htmlFor="s-tend">{t("teamAttendance.seasons.trainingEndsOn")}</Label><Input id="s-tend" type="date" min={form.trainingStartsOn || undefined} value={form.trainingEndsOn} onChange={(e) => setForm({ ...form, trainingEndsOn: e.target.value })} /></div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
      </div>
    </form>
  );

  return (
    <div className="max-w-4xl space-y-6">
      <p className="text-sm text-ink-3">{t("billing.seasons.description")}</p>
      {!canEdit && <p className="text-sm text-ink-3">{t("billing.seasons.readOnly")}</p>}
      <DefaultsForm settings={settings} canEdit={canEdit} />
      <Card>
        <CardHeader><CardTitle>{t("billing.seasons.listTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          {seasons.length === 0 && <p className="text-sm text-ink-3">{t("billing.seasons.empty")}</p>}
          {seasons.map((s) => (
            <div key={s.id} className="rounded-md border border-line p-3">
              {editing === s.id ? seasonForm : (
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="text-ink-3">{f.dateRange(s.startsOn, s.endsOn)}</span>
                    {(s.trainingStartsOn || s.trainingEndsOn) && (
                      <span className="text-ink-3">
                        {t("teamAttendance.seasons.trainingWindow", {
                          range: s.trainingStartsOn && s.trainingEndsOn ? f.dateRange(s.trainingStartsOn, s.trainingEndsOn)
                            : s.trainingStartsOn ? f.date(s.trainingStartsOn) : f.date(s.trainingEndsOn!),
                        })}
                      </span>
                    )}
                    {s.isCurrent && <Badge tone="success">{t("billing.seasons.current")}</Badge>}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      {!s.isCurrent && <Button variant="ghost" size="sm" onClick={() => makeCurrent(s.id)}>{t("billing.seasons.makeCurrent")}</Button>}
                      <Button variant="ghost" size="sm" onClick={() => open(s)}>{t("billing.entities.edit")}</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {canEdit && (editing === "new"
            ? <div className="rounded-md border border-line p-3">{seasonForm}</div>
            : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => open(null)}>{t("billing.seasons.add")}</Button>
                {next && <span className="text-xs text-ink-3">{t("billing.seasons.suggested", { range: f.dateRange(next.startsOn, next.endsOn) })}</span>}
              </div>
            ))}
          <Status msg={msg} />
        </CardBody>
      </Card>
    </div>
  );
}

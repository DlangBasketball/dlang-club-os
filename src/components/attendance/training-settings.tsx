"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { deleteTrainingBreak, saveTrainingBreak, setAttendanceGoLive } from "@/lib/actions/team-attendance";
import type { TrainingBreak } from "@/lib/attendance/data";

type Msg = { ok: boolean; text: string } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <span role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>;
}

/**
 * Settings -> Seasons: attendance go-live date and club training breaks
 * (holidays). Saving a break cancels the trainings in its range; deleting a
 * break never un-cancels sessions (the still-cancelled ones are listed).
 */
export function TrainingSettings({ goLive, breaks, seasons, canEdit }: {
  goLive: string | null;
  breaks: TrainingBreak[];
  seasons: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [date, setDate] = React.useState(goLive ?? "");
  const [form, setForm] = React.useState({ label: "", startsOn: "", endsOn: "", seasonId: "" });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const [still, setStill] = React.useState<{ event_id: string; starts_at: string }[]>([]);

  async function saveGoLive(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await setAttendanceGoLive(date || null);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? t("teamAttendance.messages.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  async function addBreak(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setStill([]);
    const res = await saveTrainingBreak({ label: form.label, startsOn: form.startsOn, endsOn: form.endsOn, seasonId: form.seasonId || null });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setForm({ label: "", startsOn: "", endsOn: "", seasonId: "" });
    setMsg({ ok: true, text: res.message ?? t("teamAttendance.messages.saved") });
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    setMsg(null);
    const res = await deleteTrainingBreak(id);
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setStill(res.data?.stillCancelled ?? []);
    setMsg({ ok: true, text: res.message ?? t("teamAttendance.messages.saved") });
    router.refresh();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <Card>
        <CardHeader><CardTitle>{t("teamAttendance.seasons.goLiveTitle")}</CardTitle></CardHeader>
        <CardBody>
          <form className="flex flex-wrap items-end gap-3" onSubmit={saveGoLive}>
            <p className="w-full text-sm text-ink-3">{t("teamAttendance.seasons.goLiveHint")}</p>
            <div>
              <Label htmlFor="ta-golive">{t("teamAttendance.seasons.goLiveLabel")}</Label>
              <Input id="ta-golive" type="date" disabled={!canEdit} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {canEdit && <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>}
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("teamAttendance.seasons.breaksTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-3">{t("teamAttendance.seasons.breaksHint")}</p>
          {breaks.length === 0 && <p className="text-sm text-ink-3">{t("teamAttendance.seasons.noBreaks")}</p>}
          {breaks.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{b.label}</span>
                <span className="text-ink-3">{f.dateRange(b.startsOn, b.endsOn)}</span>
                {b.seasonId && <span className="text-ink-3">{seasons.find((s) => s.id === b.seasonId)?.name}</span>}
                {b.cancelledSessions !== null && (
                  <span className="text-ink-3">{t("teamAttendance.seasons.cancelledCount", { count: b.cancelledSessions })}</span>
                )}
              </div>
              {canEdit && <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(b.id)}>{t("common.delete")}</Button>}
            </div>
          ))}
          {canEdit && (
            <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_10rem_10rem_10rem_auto]" onSubmit={addBreak}>
              <div><Label htmlFor="ta-blabel">{t("teamAttendance.seasons.breakLabel")}</Label>
                <Input id="ta-blabel" required maxLength={120} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
              <div><Label htmlFor="ta-bstart">{t("teamAttendance.seasons.breakStartsOn")}</Label>
                <Input id="ta-bstart" type="date" required value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></div>
              <div><Label htmlFor="ta-bend">{t("teamAttendance.seasons.breakEndsOn")}</Label>
                <Input id="ta-bend" type="date" required min={form.startsOn || undefined} value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></div>
              <div><Label htmlFor="ta-bseason">{t("teamAttendance.seasons.breakSeason")}</Label>
                <Select id="ta-bseason" value={form.seasonId} onChange={(e) => setForm({ ...form, seasonId: e.target.value })}>
                  <option value="">{t("teamAttendance.seasons.allSeasons")}</option>
                  {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select></div>
              <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("teamAttendance.seasons.addBreak")}</Button>
            </form>
          )}
          {still.length > 0 && (
            <div className="rounded-md border border-line p-3 text-sm">
              <p className="text-ink-2">{t("teamAttendance.seasons.stillCancelled", { count: still.length })}</p>
              <ul className="mt-2 list-disc pl-5 text-ink-3">
                {still.map((s) => <li key={s.event_id}><a className="underline" href={`/admin/schedule/${s.event_id}`}>{f.dateTime(s.starts_at)}</a></li>)}
              </ul>
            </div>
          )}
          <Status msg={msg} />
        </CardBody>
      </Card>
    </div>
  );
}

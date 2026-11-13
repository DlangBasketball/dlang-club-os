"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { deleteClubEvent, saveClubEvent } from "@/lib/actions/calendar";
import { CLUB_EVENT_AUDIENCES, CLUB_EVENT_TYPES, type ClubEventInput } from "@/lib/staff/validation";

export type ClubEventFormValue = {
  id: string | null; title: string; type: (typeof CLUB_EVENT_TYPES)[number]; allDay: boolean;
  startDate: string; startTime: string; endDate: string; endTime: string;
  venueId: string; teamId: string; location: string; audience: (typeof CLUB_EVENT_AUDIENCES)[number]; description: string; url: string;
};

export function ClubEventForm({
  initial, venues, teams,
}: { initial: ClubEventFormValue; venues: { id: string; name: string }[]; teams: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = React.useState(initial);
  const [busy, setBusy] = React.useState<null | "save" | "delete">(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof ClubEventFormValue>(k: K, val: ClubEventFormValue[K]) => setV((x) => ({ ...x, [k]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setMsg(null);
    const input: ClubEventInput = { ...v, startTime: v.allDay ? null : v.startTime, endTime: v.allDay ? null : v.endTime };
    const res = await saveClubEvent(input);
    setBusy(null);
    if (res.ok) {
      router.push("/admin/calendar");
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }
  async function remove() {
    if (!v.id || !window.confirm(t("staff.clubEvents.confirmDelete"))) return;
    setBusy("delete");
    const res = await deleteClubEvent(v.id);
    setBusy(null);
    if (res.ok) {
      router.push("/admin/calendar");
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="ce-title">{t("staff.clubEvents.titleField")}</Label>
        <Input id="ce-title" required maxLength={160} value={v.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ce-type">{t("staff.clubEvents.type")}</Label>
          <Select id="ce-type" value={v.type} onChange={(e) => set("type", e.target.value as ClubEventFormValue["type"])}>
            {CLUB_EVENT_TYPES.map((x) => <option key={x} value={x}>{t.dynamic(`staff.clubEvents.types.${x}`)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="ce-aud">{t("staff.clubEvents.audience")}</Label>
          <Select id="ce-aud" value={v.audience} onChange={(e) => set("audience", e.target.value as ClubEventFormValue["audience"])}>
            {CLUB_EVENT_AUDIENCES.map((x) => <option key={x} value={x}>{t.dynamic(`staff.clubEvents.audiences.${x}`)}</option>)}
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={v.allDay} onChange={(e) => set("allDay", e.target.checked)} /> {t("staff.clubEvents.allDay")}
      </label>
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="ce-sd">{t("staff.clubEvents.startDate")}</Label>
          <Input id="ce-sd" type="date" required value={v.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </div>
        {!v.allDay && (
          <div>
            <Label htmlFor="ce-st">{t("staff.clubEvents.startTime")}</Label>
            <Input id="ce-st" type="time" required value={v.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </div>
        )}
        <div>
          <Label htmlFor="ce-ed">{t("staff.clubEvents.endDate")}</Label>
          <Input id="ce-ed" type="date" required value={v.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </div>
        {!v.allDay && (
          <div>
            <Label htmlFor="ce-et">{t("staff.clubEvents.endTime")}</Label>
            <Input id="ce-et" type="time" required value={v.endTime} onChange={(e) => set("endTime", e.target.value)} />
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="ce-venue">{t("staff.clubEvents.venue")}</Label>
          <Select id="ce-venue" value={v.venueId} onChange={(e) => set("venueId", e.target.value)}>
            <option value="">{t("staff.clubEvents.noVenue")}</option>
            {venues.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="ce-loc">{t("staff.clubEvents.location")}</Label>
          <Input id="ce-loc" maxLength={200} value={v.location} onChange={(e) => set("location", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ce-team">{t("staff.clubEvents.team")}</Label>
          <Select id="ce-team" value={v.teamId} onChange={(e) => set("teamId", e.target.value)}>
            <option value="">{t("staff.clubEvents.noTeam")}</option>
            {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="ce-desc">{t("staff.clubEvents.description")}</Label>
        <Textarea id="ce-desc" maxLength={4000} value={v.description} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div>
        <Label htmlFor="ce-url">{t("staff.clubEvents.url")}</Label>
        <Input id="ce-url" type="url" inputMode="url" maxLength={500} placeholder="https://" value={v.url} onChange={(e) => set("url", e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy === "save"} disabled={!!busy}>{t("staff.clubEvents.save")}</Button>
        {v.id && (
          <Button type="button" variant="danger" loading={busy === "delete"} disabled={!!busy} onClick={remove}>
            <Trash2 className="h-4 w-4" /> {t("staff.clubEvents.delete")}
          </Button>
        )}
      </div>
      {msg && <p role="alert" className="text-sm text-danger">{msg.text}</p>}
    </form>
  );
}

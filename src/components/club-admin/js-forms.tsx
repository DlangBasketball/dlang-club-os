"use client";

import * as React from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { saveCoachJsNumber, saveJsOffer, setAthleteAhv } from "@/lib/actions/club-admin-settings";
import { useCaAction } from "./use-ca-action";

export function JsOfferRow({ p }: { p: { id: string; name: string; js_offer: boolean; js_offer_number: string | null; js_session_minutes: number | null } }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [on, setOn] = React.useState(p.js_offer);
  const [num, setNum] = React.useState(p.js_offer_number ?? "");
  const [mins, setMins] = React.useState(p.js_session_minutes != null ? String(p.js_session_minutes) : "");
  return (
    <div className="flex flex-wrap items-end gap-3 py-2">
      <label htmlFor={`jo-${p.id}`} className="flex min-w-[12rem] flex-1 items-center gap-2 text-sm text-ink">
        <input id={`jo-${p.id}`} type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> {p.name}
      </label>
      <div><Label htmlFor={`jn-${p.id}`}>{t("clubadmin.js.offerNumber")}</Label>
        <Input id={`jn-${p.id}`} className="h-8 w-40" maxLength={40} value={num} onChange={(e) => setNum(e.target.value)} /></div>
      <div><Label htmlFor={`jm-${p.id}`}>{t("clubadmin.js.sessionMinutes")}</Label>
        <Input id={`jm-${p.id}`} className="h-8 w-24" type="number" min={15} max={600} value={mins} onChange={(e) => setMins(e.target.value)} /></div>
      <Button size="sm" variant="secondary" loading={busy}
        onClick={() => run(() => saveJsOffer({ programId: p.id, jsOffer: on, jsOfferNumber: num, jsSessionMinutes: mins }))}>{t("common.save")}</Button>
      {note}
    </div>
  );
}

export function CoachNumberRow({ c }: { c: { id: string; display_name: string; js_person_number: string | null } }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [num, setNum] = React.useState(c.js_person_number ?? "");
  return (
    <div className="flex flex-wrap items-center gap-3 py-1.5">
      <label htmlFor={`cn-${c.id}`} className="min-w-[12rem] flex-1 text-sm text-ink">{c.display_name}</label>
      <Input id={`cn-${c.id}`} className="h-8 w-44" maxLength={30} placeholder={t("clubadmin.js.coachNumber")} value={num} onChange={(e) => setNum(e.target.value)} />
      <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => saveCoachJsNumber({ coachId: c.id, number: num || null }))}>{t("common.save")}</Button>
      {note}
    </div>
  );
}

/** AHV number (admin only): typed once, stored encrypted; only the last 4 digits are shown afterwards. */
export function AhvForm({ athleteId, masked }: { athleteId: string; masked: string | null }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [ahv, setAhv] = React.useState("");
  const [consent, setConsent] = React.useState("");
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {masked && <span className="tnum text-xs text-ink-3">{masked}</span>}
      {!open && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{masked ? t("clubadmin.js.ahvReplace") : t("clubadmin.js.ahvAdd")}</Button>}
      {masked && !open && <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => setAthleteAhv({ athleteId, ahv: null }))}>{t("clubadmin.js.ahvClear")}</Button>}
      {open && (
        <span className="flex flex-wrap items-center gap-2">
          <label htmlFor={`ahv-${athleteId}`} className="sr-only">{t("clubadmin.js.ahv")}</label>
          <Input id={`ahv-${athleteId}`} className="h-8 w-44" autoComplete="off" placeholder="756.0000.0000.00" value={ahv} onChange={(e) => setAhv(e.target.value)} />
          <label htmlFor={`ahc-${athleteId}`} className="sr-only">{t("clubadmin.js.consentNote")}</label>
          <Input id={`ahc-${athleteId}`} className="h-8 w-56" placeholder={t("clubadmin.js.consentNote")} value={consent} onChange={(e) => setConsent(e.target.value)} />
          <Button size="sm" loading={busy} onClick={() => run(() => setAthleteAhv({ athleteId, ahv, consentNote: consent }), () => { setOpen(false); setAhv(""); })}>{t("common.save")}</Button>
        </span>
      )}
      {note}
    </div>
  );
}

export function JsExportForm({ programs, from, to }: { programs: { id: string; name: string }[]; from: string; to: string }) {
  const t = useT();
  const [programId, setProgramId] = React.useState(programs[0]?.id ?? "");
  const [a, setA] = React.useState(from);
  const [b, setB] = React.useState(to);
  const [ahv, setAhv] = React.useState(false);
  const href = (part: string) => `/admin/js/export?${new URLSearchParams({ program: programId, from: a, to: b, part, ahv: ahv ? "1" : "0" })}`;
  if (!programs.length) return <p className="text-sm text-ink-3">{t("clubadmin.js.noOffers")}</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label htmlFor="jx-prog">{t("clubadmin.js.offer")}</Label>
          <Select id="jx-prog" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select></div>
        <div><Label htmlFor="jx-from">{t("clubadmin.common.from")}</Label><Input id="jx-from" type="date" value={a} onChange={(e) => setA(e.target.value)} /></div>
        <div><Label htmlFor="jx-to">{t("clubadmin.common.to")}</Label><Input id="jx-to" type="date" value={b} onChange={(e) => setB(e.target.value)} /></div>
      </div>
      <label htmlFor="jx-ahv" className="flex items-center gap-2 text-sm text-ink-2">
        <input id="jx-ahv" type="checkbox" checked={ahv} onChange={(e) => setAhv(e.target.checked)} /> {t("clubadmin.js.includeAhv")}
      </label>
      <div className="flex flex-wrap gap-3">
        <a href={href("participants")} className="text-sm text-maroon hover:underline">{t("clubadmin.js.downloadParticipants")}</a>
        <a href={href("sessions")} className="text-sm text-maroon hover:underline">{t("clubadmin.js.downloadSessions")}</a>
      </div>
    </div>
  );
}

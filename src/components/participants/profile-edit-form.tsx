"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { updateParticipant, updateParticipantSports, withdrawChangeRequest } from "@/lib/actions/participants";
import { SEXES } from "@/lib/participants/validation";
import { useRequestId } from "./portal-dialog";
import { SportsFields, type SportsDraft } from "./sports-fields";

export type ProfileInitial = {
  firstName: string; lastName: string; dob: string; sex: string | null;
  heightCm: number | null; weightKg: number | null; positionPref: string | null; jerseySize: string | null; preferredJerseyNumber: number | null;
};
export type PendingChange = { id: string; changes: { dob?: string; gender?: string }; createdAt: string };

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

/**
 * Parent / self profile editor. Name, DOB and sex are corrections: when a DOB
 * or sex change could affect a club enrolment, the club reviews it first (the
 * profile keeps the current value meanwhile). Sports fields save directly.
 */
export function ProfileEditForm({ athleteId, initial, pending }: { athleteId: string; initial: ProfileInitial; pending: PendingChange[] }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const legacySex = initial.sex && !(SEXES as readonly string[]).includes(initial.sex.trim().toLowerCase()) ? initial.sex.trim().toLowerCase() : null;
  const [d, setD] = React.useState({ firstName: initial.firstName, lastName: initial.lastName, dob: initial.dob, sex: (initial.sex ?? "").trim().toLowerCase() });
  const [sports, setSports] = React.useState<SportsDraft>({
    heightCm: str(initial.heightCm), weightKg: str(initial.weightKg), positionPref: initial.positionPref ?? "",
    jerseySize: initial.jerseySize ?? "", preferredJerseyNumber: str(initial.preferredJerseyNumber),
  });
  const [busy, setBusy] = React.useState<"identity" | "sports" | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [requestId, resetRequestId] = useRequestId();
  const set = (k: keyof typeof d) => (v: string) => { setMsg(null); setD((x) => ({ ...x, [k]: v })); };

  async function saveIdentity(e: React.FormEvent) {
    e.preventDefault();
    setBusy("identity"); setMsg(null);
    const res = await updateParticipant(athleteId, { ...d, ...sports }, requestId());
    setBusy(null);
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
    resetRequestId();
    setMsg({ ok: true, text: res.message ?? t("participants.edit.saved") });
    if (res.data.reviewRequired) setD((x) => ({ ...x, dob: initial.dob, sex: (initial.sex ?? "").trim().toLowerCase() }));
    router.refresh();
  }

  async function saveSports() {
    setBusy("sports"); setMsg(null);
    const res = await updateParticipantSports(athleteId, sports);
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? t("participants.edit.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  async function withdraw(id: string) {
    const res = await withdrawChangeRequest(id);
    if (!res.ok) setMsg({ ok: false, text: res.error });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div className="space-y-2 rounded-md border border-border bg-surface-elevated p-3 text-sm" role="status">
          {pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-text">
                {t("participants.edit.pendingReview", {
                  changes: [p.changes.dob ? f.date(p.changes.dob) : null, p.changes.gender ? t.dynamic(`participants.sex.${p.changes.gender}`, undefined, p.changes.gender) : null].filter(Boolean).join(" · "),
                  date: f.date(p.createdAt),
                })}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => void withdraw(p.id)}>{t("participants.edit.withdraw")}</Button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={saveIdentity} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label htmlFor="pe-fn">{t("participants.fields.firstName")}</Label>
            <Input id="pe-fn" required maxLength={80} value={d.firstName} onChange={(e) => set("firstName")(e.target.value)} /></div>
          <div><Label htmlFor="pe-ln">{t("participants.fields.lastName")}</Label>
            <Input id="pe-ln" required maxLength={80} value={d.lastName} onChange={(e) => set("lastName")(e.target.value)} /></div>
          <div><Label htmlFor="pe-dob">{t("participants.fields.dob")}</Label>
            <Input id="pe-dob" type="date" required value={d.dob} onChange={(e) => set("dob")(e.target.value)} /></div>
          <div><Label htmlFor="pe-sex">{t("participants.fields.sex")}</Label>
            <Select id="pe-sex" value={d.sex} onChange={(e) => set("sex")(e.target.value)}>
              {!d.sex && <option value="">{t("common.select")}</option>}
              {legacySex && <option value={legacySex}>{t.dynamic(`editPeople.gender.${legacySex}`, undefined, legacySex)}</option>}
              {SEXES.map((s) => <option key={s} value={s}>{t(`participants.sex.${s}`)}</option>)}
            </Select></div>
        </div>
        <p className="text-xs text-text-muted">{t("participants.edit.eligibilityHint")}</p>
        <Button type="submit" loading={busy === "identity"} disabled={busy !== null}>{t("participants.edit.save")}</Button>
      </form>
      <div className="space-y-3 border-t border-border-soft pt-4">
        <h3 className="text-sm font-semibold text-text">{t("participants.edit.sportsTitle")}</h3>
        <SportsFields value={sports} onChange={(v) => { setMsg(null); setSports(v); }} idPrefix="pe-sp" />
        <Button type="button" variant="secondary" loading={busy === "sports"} disabled={busy !== null} onClick={() => void saveSports()}>
          {t("participants.edit.saveSports")}
        </Button>
      </div>
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}

/** Coach / staff: sports fields only (never name, DOB, sex or medical data; never team jersey numbers). */
export function SportsProfileForm({ athleteId, initial }: { athleteId: string; initial: Omit<ProfileInitial, "firstName" | "lastName" | "dob" | "sex"> }) {
  const t = useT();
  const router = useRouter();
  const [sports, setSports] = React.useState<SportsDraft>({
    heightCm: str(initial.heightCm), weightKg: str(initial.weightKg), positionPref: initial.positionPref ?? "",
    jerseySize: initial.jerseySize ?? "", preferredJerseyNumber: str(initial.preferredJerseyNumber),
  });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await updateParticipantSports(athleteId, sports);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? t("participants.edit.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <SportsFields value={sports} onChange={(v) => { setMsg(null); setSports(v); }} idPrefix="cs-sp" />
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      <Button type="submit" loading={busy}>{t("participants.edit.saveSports")}</Button>
    </form>
  );
}

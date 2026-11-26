"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { clearanceFileUrl, deleteIncident, saveIncident, uploadClearance } from "@/lib/actions/club-admin-incidents";
import { BODY_PARTS, INFORMED_HOW, REFERRALS, RETURN_STATUSES, SEVERITIES } from "@/lib/club-admin/incidents";
import { useCaAction } from "./use-ca-action";

type Opt = { id: string; name: string };

export type IncidentFormValue = {
  id: string | null; athleteId: string; occurredAt: string; programId: string; teamId: string; location: string; description: string;
  bodyPart: string; severity: string; firstAidGiven: boolean; firstAidDetails: string; firstAidBy: string; parentsInformedAt: string;
  parentsInformedHow: string; referral: string; followUpNotes: string; returnStatus: string; clearedOn: string; status: "open" | "closed";
};

/** "2026-11-18T09:30" (browser local) <-> ISO. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const toIso = (local: string) => (local ? new Date(local).toISOString() : "");

export function IncidentForm({ initial, athletes, programs, teams, canClose, backHref }: {
  initial: IncidentFormValue; athletes: Opt[]; programs: Opt[]; teams: Opt[]; canClose: boolean; backHref: string;
}) {
  const t = useT();
  const router = useRouter();
  const { busy, run, note } = useCaAction();
  const [v, setV] = React.useState(initial);
  const set = <K extends keyof IncidentFormValue>(k: K, val: IncidentFormValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const L = (group: string, k: string) => t.dynamic(`clubadmin.incidents.${group}.${k}`, undefined, k);
  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">{t("clubadmin.incidents.sectionEvent")}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label htmlFor="in-athlete">{t("clubadmin.incidents.athlete")}</Label>
            <Select id="in-athlete" value={v.athleteId} disabled={!!v.id} onChange={(e) => set("athleteId", e.target.value)}>
              <option value="">—</option>{athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select></div>
          <div><Label htmlFor="in-when">{t("clubadmin.incidents.occurredAt")}</Label>
            <Input id="in-when" type="datetime-local" value={v.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} /></div>
          <div><Label htmlFor="in-loc">{t("clubadmin.incidents.location")}</Label>
            <Input id="in-loc" maxLength={200} value={v.location} onChange={(e) => set("location", e.target.value)} /></div>
          <div><Label htmlFor="in-prog">{t("clubadmin.incidents.program")}</Label>
            <Select id="in-prog" value={v.programId} onChange={(e) => set("programId", e.target.value)}>
              <option value="">—</option>{programs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select></div>
          <div><Label htmlFor="in-team">{t("clubadmin.incidents.team")}</Label>
            <Select id="in-team" value={v.teamId} onChange={(e) => set("teamId", e.target.value)}>
              <option value="">—</option>{teams.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select></div>
          <div><Label htmlFor="in-body">{t("clubadmin.incidents.bodyPart")}</Label>
            <Select id="in-body" value={v.bodyPart} onChange={(e) => set("bodyPart", e.target.value)}>
              {BODY_PARTS.map((k) => <option key={k} value={k}>{L("bodyParts", k)}</option>)}
            </Select></div>
          <div><Label htmlFor="in-sev">{t("clubadmin.incidents.severity")}</Label>
            <Select id="in-sev" value={v.severity} onChange={(e) => set("severity", e.target.value)}>
              {SEVERITIES.map((k) => <option key={k} value={k}>{L("severities", k)}</option>)}
            </Select></div>
        </div>
        <div><Label htmlFor="in-desc">{t("clubadmin.incidents.description")}</Label>
          <Textarea id="in-desc" rows={4} maxLength={4000} value={v.description} onChange={(e) => set("description", e.target.value)} />
          <FieldHint>{t("clubadmin.incidents.descriptionHint")}</FieldHint></div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">{t("clubadmin.incidents.sectionCare")}</legend>
        <label htmlFor="in-fa" className="flex items-center gap-2 text-sm text-ink-2">
          <input id="in-fa" type="checkbox" checked={v.firstAidGiven} onChange={(e) => set("firstAidGiven", e.target.checked)} /> {t("clubadmin.incidents.firstAidGiven")}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label htmlFor="in-faby">{t("clubadmin.incidents.firstAidBy")}</Label>
            <Input id="in-faby" maxLength={120} value={v.firstAidBy} onChange={(e) => set("firstAidBy", e.target.value)} /></div>
          <div><Label htmlFor="in-pat">{t("clubadmin.incidents.parentsInformedAt")}</Label>
            <Input id="in-pat" type="datetime-local" value={v.parentsInformedAt} onChange={(e) => set("parentsInformedAt", e.target.value)} /></div>
          <div><Label htmlFor="in-pah">{t("clubadmin.incidents.parentsInformedHow")}</Label>
            <Select id="in-pah" value={v.parentsInformedHow} onChange={(e) => set("parentsInformedHow", e.target.value)}>
              <option value="">—</option>{INFORMED_HOW.map((k) => <option key={k} value={k}>{L("informedHow", k)}</option>)}
            </Select></div>
          <div><Label htmlFor="in-ref">{t("clubadmin.incidents.referral")}</Label>
            <Select id="in-ref" value={v.referral} onChange={(e) => set("referral", e.target.value)}>
              {REFERRALS.map((k) => <option key={k} value={k}>{L("referrals", k)}</option>)}
            </Select></div>
        </div>
        <div><Label htmlFor="in-fad">{t("clubadmin.incidents.firstAidDetails")}</Label>
          <Textarea id="in-fad" rows={2} maxLength={2000} value={v.firstAidDetails} onChange={(e) => set("firstAidDetails", e.target.value)} /></div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">{t("clubadmin.incidents.sectionFollowUp")}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label htmlFor="in-rtp">{t("clubadmin.incidents.returnStatus")}</Label>
            <Select id="in-rtp" value={v.returnStatus} onChange={(e) => set("returnStatus", e.target.value)}>
              {RETURN_STATUSES.map((k) => <option key={k} value={k}>{L("returnStatuses", k)}</option>)}
            </Select></div>
          <div><Label htmlFor="in-clr">{t("clubadmin.incidents.clearedOn")}</Label>
            <Input id="in-clr" type="date" value={v.clearedOn} onChange={(e) => set("clearedOn", e.target.value)} /></div>
          {canClose && (
            <div><Label htmlFor="in-st">{t("clubadmin.incidents.status")}</Label>
              <Select id="in-st" value={v.status} onChange={(e) => set("status", e.target.value as "open" | "closed")}>
                <option value="open">{L("statuses", "open")}</option>
                <option value="closed">{L("statuses", "closed")}</option>
              </Select></div>
          )}
        </div>
        <div><Label htmlFor="in-fu">{t("clubadmin.incidents.followUpNotes")}</Label>
          <Textarea id="in-fu" rows={3} maxLength={4000} value={v.followUpNotes} onChange={(e) => set("followUpNotes", e.target.value)} /></div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button loading={busy} disabled={!v.athleteId || !v.occurredAt} onClick={() => run(() => saveIncident(v.id, {
          athleteId: v.athleteId, occurredAt: toIso(v.occurredAt), programId: v.programId, teamId: v.teamId, location: v.location,
          description: v.description, bodyPart: v.bodyPart as never, severity: v.severity as never, firstAidGiven: v.firstAidGiven,
          firstAidDetails: v.firstAidDetails, firstAidBy: v.firstAidBy, parentsInformedAt: toIso(v.parentsInformedAt),
          parentsInformedHow: v.parentsInformedHow as never, referral: v.referral as never, followUpNotes: v.followUpNotes,
          returnStatus: v.returnStatus as never, clearedOn: v.clearedOn, status: v.status,
        }), (r) => { if (!v.id && r.ok && r.data) router.push(`${backHref}/${r.data.id}`); })}>{t("common.save")}</Button>
        {note}
      </div>
    </div>
  );
}

export function ClearanceUpload({ id }: { id: string }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`cl-${id}`} className="sr-only">{t("clubadmin.incidents.clearanceDocument")}</label>
      <input id={`cl-${id}`} ref={ref} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="text-sm text-ink-2" />
      <Button size="sm" variant="secondary" loading={busy} onClick={() => {
        const fd = new FormData();
        const file = ref.current?.files?.[0];
        if (file) fd.set("file", file);
        return run(() => uploadClearance(id, fd));
      }}>{t("clubadmin.incidents.upload")}</Button>
      {note}
    </div>
  );
}

export function ClearanceLink({ id }: { id: string }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => clearanceFileUrl(id), (r) => { if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener"); })}>
        {t("clubadmin.incidents.viewClearance")}
      </Button>
      {note}
    </span>
  );
}

export function DeleteIncidentButton({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, run, note } = useCaAction();
  const [confirm, setConfirm] = React.useState(false);
  return (
    <span className="flex items-center gap-2">
      {!confirm && <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>{t("common.delete")}</Button>}
      {confirm && <Button size="sm" variant="danger" loading={busy} onClick={() => run(() => deleteIncident(id), () => router.push("/admin/incidents"))}>{t("clubadmin.common.confirm")}</Button>}
      {note}
    </span>
  );
}

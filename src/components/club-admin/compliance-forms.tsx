"use client";

import * as React from "react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { assignCoachWithOverride, certificateFileUrl, deleteCertificate, saveCertificate, verifyCertificate } from "@/lib/actions/club-admin-compliance";
import { CERT_KINDS } from "@/lib/club-admin/compliance";
import { useCaAction } from "./use-ca-action";

type Opt = { id: string; name: string };

export type CertFormValue = {
  id: string | null; coachId: string; kind: string; title: string; reference: string; issuedOn: string; validUntil: string; notes: string;
};

/** Add / edit a certificate with an optional document (PDF / image, max 2.5 MB). */
export function CertificateForm({ initial, coaches }: { initial: CertFormValue; coaches?: Opt[] }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [v, setV] = React.useState(initial);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const set = <K extends keyof CertFormValue>(k: K, val: CertFormValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const p = v.id ?? `new-${initial.coachId || "x"}`;
  function submit() {
    const fd = new FormData();
    for (const [k, val] of Object.entries(v)) if (val != null) fd.set(k, String(val));
    const file = fileRef.current?.files?.[0];
    if (file) fd.set("file", file);
    return run(() => saveCertificate(fd), () => { if (!v.id) { setV(initial); if (fileRef.current) fileRef.current.value = ""; } });
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {coaches && (
          <div><Label htmlFor={`cf-coach-${p}`}>{t("clubadmin.compliance.coach")}</Label>
            <Select id={`cf-coach-${p}`} value={v.coachId} onChange={(e) => set("coachId", e.target.value)}>
              <option value="">—</option>{coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select></div>
        )}
        <div><Label htmlFor={`cf-kind-${p}`}>{t("clubadmin.compliance.kind")}</Label>
          <Select id={`cf-kind-${p}`} value={v.kind} onChange={(e) => set("kind", e.target.value)}>
            {CERT_KINDS.map((k) => <option key={k} value={k}>{t.dynamic(`clubadmin.compliance.kinds.${k}`, undefined, k)}</option>)}
          </Select></div>
        <div className="sm:col-span-2"><Label htmlFor={`cf-title-${p}`}>{t("clubadmin.compliance.titleField")}</Label>
          <Input id={`cf-title-${p}`} maxLength={160} placeholder={t("clubadmin.compliance.titlePlaceholder")} value={v.title} onChange={(e) => set("title", e.target.value)} /></div>
        <div><Label htmlFor={`cf-ref-${p}`}>{t("clubadmin.compliance.reference")}</Label>
          <Input id={`cf-ref-${p}`} maxLength={80} value={v.reference} onChange={(e) => set("reference", e.target.value)} /></div>
        <div><Label htmlFor={`cf-issued-${p}`}>{t("clubadmin.compliance.issuedOn")}</Label>
          <Input id={`cf-issued-${p}`} type="date" value={v.issuedOn} onChange={(e) => set("issuedOn", e.target.value)} /></div>
        <div><Label htmlFor={`cf-until-${p}`}>{t("clubadmin.compliance.validUntil")}</Label>
          <Input id={`cf-until-${p}`} type="date" value={v.validUntil} onChange={(e) => set("validUntil", e.target.value)} /></div>
        <div><Label htmlFor={`cf-file-${p}`}>{t("clubadmin.compliance.document")}</Label>
          <input id={`cf-file-${p}`} ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="block w-full text-sm text-ink-2" /></div>
      </div>
      <div><Label htmlFor={`cf-notes-${p}`}>{t("clubadmin.compliance.notes")}</Label>
        <Textarea id={`cf-notes-${p}`} rows={2} maxLength={1000} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} disabled={!v.coachId} onClick={submit}>{t("common.save")}</Button>
        {note}
      </div>
    </div>
  );
}

export function CertificateActions({ id, status, hasFile, admin }: { id: string; status: string; hasFile: boolean; admin: boolean }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [reject, setReject] = React.useState(false);
  const [reason, setReason] = React.useState("");
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {hasFile && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => certificateFileUrl(id), (r) => { if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener"); })}>
          {t("clubadmin.compliance.viewDocument")}
        </Button>
      )}
      {admin && status !== "verified" && <Button size="sm" variant="success" loading={busy} onClick={() => run(() => verifyCertificate(id, "verified"))}>{t("clubadmin.compliance.verify")}</Button>}
      {admin && status !== "rejected" && !reject && <Button size="sm" variant="ghost" onClick={() => setReject(true)}>{t("clubadmin.compliance.reject")}</Button>}
      {admin && reject && (
        <span className="flex items-center gap-1.5">
          <label htmlFor={`rj-${id}`} className="sr-only">{t("clubadmin.common.reason")}</label>
          <Input id={`rj-${id}`} className="h-8 w-44" placeholder={t("clubadmin.common.reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="danger" loading={busy} onClick={() => run(() => verifyCertificate(id, "rejected", reason))}>{t("clubadmin.common.confirm")}</Button>
        </span>
      )}
      {admin && <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => deleteCertificate(id))}>{t("common.delete")}</Button>}
      {note}
    </div>
  );
}

/** Assign a coach to a youth team despite missing checks (reason recorded). */
export function OverrideForm({ teams, coaches }: { teams: Opt[]; coaches: Opt[] }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [teamId, setTeamId] = React.useState("");
  const [coachId, setCoachId] = React.useState("");
  const [role, setRole] = React.useState("assistant");
  const [reason, setReason] = React.useState("");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div><Label htmlFor="ov-team">{t("clubadmin.compliance.team")}</Label>
          <Select id="ov-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">—</option>{teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor="ov-coach">{t("clubadmin.compliance.coach")}</Label>
          <Select id="ov-coach" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            <option value="">—</option>{coaches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor="ov-role">{t("clubadmin.compliance.role")}</Label>
          <Select id="ov-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {["head", "assistant", "manager", "trainer"].map((r) => <option key={r} value={r}>{t.dynamic(`clubadmin.compliance.roles.${r}`, undefined, r)}</option>)}
          </Select></div>
        <div><Label htmlFor="ov-reason">{t("clubadmin.common.reason")}</Label>
          <Input id="ov-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="danger" loading={busy} disabled={!teamId || !coachId}
          onClick={() => run(() => assignCoachWithOverride({ teamId, coachId, role, reason }))}>{t("clubadmin.compliance.assignAnyway")}</Button>
        {note}
      </div>
    </div>
  );
}

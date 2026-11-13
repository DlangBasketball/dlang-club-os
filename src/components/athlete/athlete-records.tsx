"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Pencil, Shield, ShieldCheck, ShieldOff } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label, Select, Badge, statusTone } from "@/components/ui";
import { useT, useFormat } from "@/lib/i18n/client";
import { createRegistration } from "@/lib/actions/registration";
import { recordConsent, withdrawConsentRecord } from "@/lib/actions/consents-admin";
import { CONSENT_SOURCES } from "@/lib/people/validation";
import type { AthleteRegistrationRow, AthleteTeamRow, ConsentFormOpt, ConsentRecordRow, Opt } from "@/lib/data/people-edit";

type Msg = { ok: boolean; text: string } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>;
}

/** Programme registrations (edit links + enrol) and team memberships (read-only here). */
export function AthleteProgrammes({
  athleteId,
  registrations,
  teams,
  programs,
}: {
  athleteId: string;
  registrations: AthleteRegistrationRow[];
  teams: AthleteTeamRow[];
  programs: Opt[];
}) {
  const t = useT();
  const router = useRouter();
  const enrolled = new Set(registrations.map((r) => r.programId));
  const available = programs.filter((p) => !enrolled.has(p.id));
  const [programId, setProgramId] = React.useState("");
  const [status, setStatus] = React.useState<"confirmed" | "pending" | "waitlist">("confirmed");
  const [pending, setPending] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);

  async function enrol(e: React.FormEvent) {
    e.preventDefault();
    if (!programId) return;
    setPending(true);
    setMsg(null);
    const res = await createRegistration({ athleteId, programId, status });
    setPending(false);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.registrations.enrolled") });
      setProgramId("");
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> {t("editPeople.programmes.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-5">
        {registrations.length === 0 ? (
          <p className="text-sm text-ink-3">{t("editPeople.programmes.none")}</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded border border-line-soft">
            {registrations.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{r.programName}</div>
                  {r.status === "cancelled" && r.cancellationReason && <div className="truncate text-xs text-ink-3">{r.cancellationReason}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status)}</Badge>
                  <Link href={`/admin/registrations/${r.id}`} aria-label={t("editPeople.programmes.editRegistration")}>
                    <Button size="sm" variant="ghost" type="button"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        {available.length > 0 && (
          <form onSubmit={enrol} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div>
              <Label htmlFor="enrol-program">{t("editPeople.programmes.enrolTitle")}</Label>
              <Select id="enrol-program" value={programId} onChange={(e) => setProgramId(e.target.value)} required>
                <option value="">{t("common.select")}</option>
                {available.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="enrol-status">{t("editPeople.programmes.status")}</Label>
              <Select id="enrol-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                {(["confirmed", "pending", "waitlist"] as const).map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
              </Select>
            </div>
            <Button type="submit" loading={pending} disabled={!programId}>{t("editPeople.programmes.enrol")}</Button>
          </form>
        )}
        <Status msg={msg} />

        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink"><Shield className="h-4 w-4" /> {t("editPeople.programmes.teams")}</div>
          {teams.length === 0 ? (
            <p className="text-sm text-ink-3">{t("editPeople.programmes.noTeams")}</p>
          ) : (
            <ul className="divide-y divide-line-soft rounded border border-line-soft">
              {teams.map((m) => (
                <li key={m.teamId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0 text-sm text-ink">
                    {m.teamName}
                    {(m.jerseyNumber !== null || m.position) && (
                      <span className="ml-2 text-xs text-ink-3">
                        {[m.jerseyNumber !== null ? t("editPeople.programmes.jersey", { number: m.jerseyNumber }) : null, m.position].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  <Link href={`/admin/teams/${m.teamId}`} className="shrink-0 text-xs text-maroon hover:underline">{t("editPeople.programmes.manageTeam")}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** Consent history for one athlete: record a manual consent, withdraw with reason. Never edits a record. */
export function AthleteConsents({
  athleteId,
  consents,
  forms,
  guardians,
}: {
  athleteId: string;
  consents: ConsentRecordRow[];
  forms: ConsentFormOpt[];
  guardians: Opt[];
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [formId, setFormId] = React.useState("");
  const [source, setSource] = React.useState<(typeof CONSENT_SOURCES)[number]>("paper");
  const [signedOn, setSignedOn] = React.useState(today);
  const [signerName, setSignerName] = React.useState("");
  const [guardianId, setGuardianId] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const [withdrawFor, setWithdrawFor] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [withdrawing, setWithdrawing] = React.useState(false);

  async function record(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = await recordConsent({ athleteId, consentFormId: formId, source, signedOn, signerName, guardianId: guardianId || null });
    setPending(false);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.consents.recorded") });
      setFormId("");
      setSignerName("");
      setGuardianId("");
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  async function withdraw(id: string) {
    setWithdrawing(true);
    setMsg(null);
    const res = await withdrawConsentRecord(id, reason);
    setWithdrawing(false);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.consents.withdrawn") });
      setWithdrawFor(null);
      setReason("");
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> {t("editPeople.consents.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-5">
        <p className="text-xs text-ink-3">{t("editPeople.consents.history")} {t("editPeople.consents.mediaNote")}</p>
        {consents.length === 0 ? (
          <p className="text-sm text-ink-3">{t("editPeople.consents.none")}</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded border border-line-soft">
            {consents.map((c) => (
              <li key={c.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-ink">
                      {c.status === "accepted" ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldOff className="h-4 w-4 text-ink-4" />}
                      <span className="truncate">{c.formTitle}</span>
                      <span className="text-xs text-ink-3">{t("editPeople.consents.version", { version: c.version })}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {t("editPeople.consents.acceptedOn", { date: f.date(c.acceptedAt) })}
                      {" · "}{t.dynamic(`editPeople.consentSource.${c.source}`, undefined, c.source)}
                      {(c.signerName || c.acceptedByName) && <> · {t("editPeople.consents.signer")}: {c.signerName ?? c.acceptedByName}</>}
                      {c.recordedByName && <> · {t("editPeople.consents.recordedBy", { name: c.recordedByName })}</>}
                    </div>
                    {c.withdrawnAt && (
                      <div className="mt-0.5 text-xs text-warning">
                        {t("editPeople.consents.withdrawnOn", { date: f.date(c.withdrawnAt) })}
                        {c.withdrawalReason && <> — {c.withdrawalReason}</>}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={statusTone(c.status)}>{t.dynamic(`status.${c.status}`, undefined, c.status)}</Badge>
                    {c.status === "accepted" && withdrawFor !== c.id && (
                      <Button size="sm" variant="ghost" type="button" onClick={() => { setWithdrawFor(c.id); setReason(""); }}>
                        {t("editPeople.consents.withdraw")}
                      </Button>
                    )}
                  </div>
                </div>
                {withdrawFor === c.id && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                    <div>
                      <Label htmlFor={`wr-${c.id}`}>{t("editPeople.consents.withdrawReason")}</Label>
                      <Input id={`wr-${c.id}`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
                    </div>
                    <Button size="sm" variant="danger" type="button" loading={withdrawing} disabled={reason.trim().length < 3} onClick={() => withdraw(c.id)}>
                      {t("editPeople.consents.confirmWithdraw")}
                    </Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setWithdrawFor(null)}>{t("editPeople.cancel")}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {forms.length > 0 && (
          <form onSubmit={record} className="space-y-3 rounded border border-line-soft p-4">
            <div className="text-sm font-medium text-ink">{t("editPeople.consents.recordTitle")}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="c-form">{t("editPeople.consents.form")}</Label>
                <Select id="c-form" value={formId} onChange={(e) => setFormId(e.target.value)} required>
                  <option value="">{t("common.select")}</option>
                  {forms.map((o) => <option key={o.id} value={o.id}>{o.label} ({t("editPeople.consents.version", { version: o.version })})</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="c-source">{t("editPeople.consents.source")}</Label>
                <Select id="c-source" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                  {CONSENT_SOURCES.map((s) => <option key={s} value={s}>{t(`editPeople.consentSource.${s}`)}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="c-date">{t("editPeople.consents.signedOn")}</Label>
                <Input id="c-date" type="date" max={today} value={signedOn} onChange={(e) => setSignedOn(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="c-signer">{t("editPeople.consents.signerName")}</Label>
                <Input id="c-signer" value={signerName} maxLength={120} onChange={(e) => setSignerName(e.target.value)} required />
              </div>
              {guardians.length > 0 && (
                <div className="sm:col-span-2">
                  <Label htmlFor="c-guardian">{t("editPeople.consents.guardian")} ({t("editPeople.optional")})</Label>
                  <Select id="c-guardian" value={guardianId} onChange={(e) => setGuardianId(e.target.value)}>
                    <option value="">{t("editPeople.none")}</option>
                    {guardians.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </Select>
                </div>
              )}
            </div>
            <Button type="submit" loading={pending} disabled={!formId || !signerName.trim()}>{t("editPeople.consents.recordButton")}</Button>
          </form>
        )}
        <Status msg={msg} />
      </CardBody>
    </Card>
  );
}

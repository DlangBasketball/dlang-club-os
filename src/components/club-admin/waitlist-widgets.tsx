"use client";

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import {
  adminAddToWaitlist, joinWaitlist, leaveWaitlist, moveWaitlistEntry, offerWaitlistEntryNow, respondToOffer, runWaitlistsNow, skipWaitlistEntry,
} from "@/lib/actions/club-admin-waitlist";
import { useCaAction } from "./use-ca-action";
import { AthletePickerField, initialAthlete, type AthleteChoices } from "@/components/participants/athlete-picker-field";

type Opt = { id: string; name: string };
export type TargetOpt = { kind: "program" | "camp_edition"; id: string; label: string; programId: string; full: boolean };

export function RunWaitlistsButton() {
  const t = useT();
  const { busy, run, note } = useCaAction();
  return (
    <span className="flex items-center gap-3">
      <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => runWaitlistsNow())}>{t("clubadmin.waitlist.runNow")}</Button>
      {note}
    </span>
  );
}

export function EntryActions({ id, position, last, status }: { id: string; position: number; last: boolean; status: string }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [skip, setSkip] = React.useState(false);
  const [reason, setReason] = React.useState("");
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button size="icon" variant="ghost" aria-label={t("clubadmin.waitlist.moveUp")} disabled={busy || position <= 1}
        onClick={() => run(() => moveWaitlistEntry(id, position - 1))}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" aria-label={t("clubadmin.waitlist.moveDown")} disabled={busy || last}
        onClick={() => run(() => moveWaitlistEntry(id, position + 1))}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
      {status === "waiting" && (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => offerWaitlistEntryNow(id))}>{t("clubadmin.waitlist.offerNow")}</Button>
      )}
      {!skip && <Button size="sm" variant="ghost" onClick={() => setSkip(true)}>{t("clubadmin.waitlist.skip")}</Button>}
      {skip && (
        <span className="flex items-center gap-1.5">
          <label htmlFor={`sk-${id}`} className="sr-only">{t("clubadmin.common.reason")}</label>
          <Input id={`sk-${id}`} className="h-8 w-44" placeholder={t("clubadmin.common.reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="danger" loading={busy} onClick={() => run(() => skipWaitlistEntry(id, reason))}>{t("clubadmin.common.confirm")}</Button>
        </span>
      )}
      {note}
    </div>
  );
}

function CampChoice({ programId, options, groups, optionId, setOptionId, groupId, setGroupId, idp }: {
  programId: string; options: Record<string, { id: string; label: string }[]>; groups: Record<string, { id: string; label: string }[]>;
  optionId: string; setOptionId: (v: string) => void; groupId: string; setGroupId: (v: string) => void; idp: string;
}) {
  const t = useT();
  return (
    <>
      <div><Label htmlFor={`${idp}-opt`}>{t("clubadmin.waitlist.option")}</Label>
        <Select id={`${idp}-opt`} value={optionId} onChange={(e) => setOptionId(e.target.value)}>
          <option value="">—</option>{(options[programId] ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select></div>
      <div><Label htmlFor={`${idp}-grp`}>{t("clubadmin.waitlist.ageGroup")}</Label>
        <Select id={`${idp}-grp`} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">—</option>{(groups[programId] ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select></div>
    </>
  );
}

/** Admin: add someone to a programme / camp week list. */
export function AdminAddForm({ targets, athletes, options, groups }: {
  targets: TargetOpt[]; athletes: Opt[]; options: Record<string, { id: string; label: string }[]>; groups: Record<string, { id: string; label: string }[]>;
}) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [target, setTarget] = React.useState("");
  const [athleteId, setAthleteId] = React.useState("");
  const [optionId, setOptionId] = React.useState("");
  const [groupId, setGroupId] = React.useState("");
  const tg = targets.find((x) => `${x.kind}:${x.id}` === target);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><Label htmlFor="wa-target">{t("clubadmin.waitlist.list")}</Label>
          <Select id="wa-target" value={target} onChange={(e) => { setTarget(e.target.value); setOptionId(""); setGroupId(""); }}>
            <option value="">—</option>
            {targets.map((x) => <option key={`${x.kind}:${x.id}`} value={`${x.kind}:${x.id}`}>{x.label}{x.full ? ` · ${t("clubadmin.waitlist.full")}` : ""}</option>)}
          </Select></div>
        <div className="sm:col-span-2"><Label htmlFor="wa-athlete">{t("clubadmin.common.athlete")}</Label>
          <Select id="wa-athlete" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
            <option value="">—</option>{athletes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        {tg?.kind === "camp_edition" && (
          <CampChoice programId={tg.programId} options={options} groups={groups} optionId={optionId} setOptionId={setOptionId} groupId={groupId} setGroupId={setGroupId} idp="wa" />
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} disabled={!tg || !athleteId}
          onClick={() => tg && run(() => adminAddToWaitlist({ kind: tg.kind, targetId: tg.id, athleteId, priceOptionId: optionId, ageGroupId: groupId }))}>
          {t("clubadmin.waitlist.add")}
        </Button>
        {note}
      </div>
    </div>
  );
}

/** Parent: put a child on a full programme / camp week list (shared athlete picker, active athlete preselected). */
export function ParentJoinWaitlist({ targets, choices, active, today, options, groups }: {
  targets: TargetOpt[]; choices: AthleteChoices; active: string | null; today: string;
  options: Record<string, { id: string; label: string }[]>; groups: Record<string, { id: string; label: string }[]>;
}) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [target, setTarget] = React.useState("");
  const [athleteId, setAthleteId] = React.useState(() => initialAthlete(active, choices.participants.map((p) => p.id)) || (choices.participants[0]?.id ?? ""));
  const [optionId, setOptionId] = React.useState("");
  const [groupId, setGroupId] = React.useState("");
  const tg = targets.find((x) => `${x.kind}:${x.id}` === target);
  if (!targets.length) return <p className="text-sm text-ink-3">{t("clubadmin.waitlist.nothingFull")}</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor="pw-target">{t("clubadmin.waitlist.list")}</Label>
          <Select id="pw-target" value={target} onChange={(e) => { setTarget(e.target.value); setOptionId(""); setGroupId(""); }}>
            <option value="">—</option>
            {targets.map((x) => <option key={`${x.kind}:${x.id}`} value={`${x.kind}:${x.id}`}>{x.label}</option>)}
          </Select></div>
        {tg?.kind === "camp_edition" && (
          <CampChoice programId={tg.programId} options={options} groups={groups} optionId={optionId} setOptionId={setOptionId} groupId={groupId} setGroupId={setGroupId} idp="pw" />
        )}
      </div>
      <AthletePickerField idPrefix="pw-child" legend={t("myAthletes.picker.legend")} choices={choices} value={athleteId}
        onChange={(id) => setAthleteId(id)} activityDate={today} />
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} disabled={!tg || !athleteId || (tg.kind === "camp_edition" && !optionId)}
          onClick={() => tg && run(() => joinWaitlist({ kind: tg.kind, targetId: tg.id, athleteId, priceOptionId: optionId, ageGroupId: groupId }))}>
          {t("clubadmin.waitlist.join")}
        </Button>
        {note}
      </div>
    </div>
  );
}

export function LeaveWaitlistButton({ id }: { id: string }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => leaveWaitlist(id))}>{t("clubadmin.waitlist.leave")}</Button>
      {note}
    </span>
  );
}

/** Public offer page: accept / decline. */
export function OfferResponse({ token }: { token: string }) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function respond(accept: boolean) {
    setBusy(true);
    const r = await respondToOffer(token, accept);
    setBusy(false);
    setResult(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error });
  }
  if (result?.ok) return <p role="status" className="text-sm text-success">{result.text}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button loading={busy} onClick={() => respond(true)}>{t("clubadmin.waitlist.accept")}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => respond(false)}>{t("clubadmin.waitlist.decline")}</Button>
      </div>
      {result && <p role="alert" className="text-sm text-danger">{result.text}</p>}
    </div>
  );
}

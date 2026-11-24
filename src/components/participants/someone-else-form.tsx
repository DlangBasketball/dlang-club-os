"use client";

import * as React from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { createThirdPartyParticipant } from "@/lib/participants/third-party";
import { BOOKER_RELATIONS, SEXES, type ParticipantOption } from "@/lib/participants/validation";
import { useRequestId } from "./portal-dialog";

/** What the "Someone else" slot receives from the ParticipantPicker (Workstream B renders its own UI here). */
export type SomeoneElseSlotContext = {
  /** Activity date (YYYY-MM-DD) of the booking. */
  activityDate: string;
  /** Hand the new participant to the picker: it is added to the list and selected. */
  onCreated: (p: ParticipantOption) => void;
  /** Leave the "Someone else" mode. */
  onCancel: () => void;
  idPrefix: string;
};

type Draft = {
  firstName: string; lastName: string; dob: string; sex: string;
  guardianName: string; guardianEmail: string; guardianPhone: string; relation: string;
};
const empty = (): Draft => ({ firstName: "", lastName: "", dob: "", sex: "", guardianName: "", guardianEmail: "", guardianPhone: "", relation: "" });

/**
 * Default "Someone else" form: the participant (name, DOB, sex), the
 * participant's own parent / legal guardian (who will be asked for consent)
 * and how the booker knows them. The booker stays the booker / payer and is
 * never added to the participant's family. Calls createThirdPartyParticipant
 * (Workstream B implements it; until then it answers THIRD_PARTY_NOT_ENABLED).
 * No <form> element: the picker sits inside booking forms.
 */
export function SomeoneElseForm({ onCreated, onCancel, idPrefix }: SomeoneElseSlotContext) {
  const t = useT();
  const [d, setD] = React.useState<Draft>(empty);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [requestId, resetRequestId] = useRequestId();
  const set = (k: keyof Draft) => (v: string) => { setErr(null); setD((x) => ({ ...x, [k]: v })); };
  const id = (k: string) => `${idPrefix}-so-${k}`;

  async function submit() {
    setBusy(true); setErr(null);
    const res = await createThirdPartyParticipant({
      firstName: d.firstName, lastName: d.lastName, dob: d.dob, sex: d.sex as (typeof SEXES)[number],
      guardianName: d.guardianName, guardianEmail: d.guardianEmail, guardianPhone: d.guardianPhone,
      relation: d.relation as (typeof BOOKER_RELATIONS)[number],
    }, requestId());
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    resetRequestId();
    setD(empty());
    onCreated(res.data.participant);
  }

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <p className="text-sm text-text-muted">{t("participants.someoneElse.intro")}</p>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-text">{t("participants.someoneElse.participant")}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label htmlFor={id("fn")}>{t("participants.fields.firstName")}</Label>
            <Input id={id("fn")} maxLength={80} autoComplete="off" value={d.firstName} onChange={(e) => set("firstName")(e.target.value)} /></div>
          <div><Label htmlFor={id("ln")}>{t("participants.fields.lastName")}</Label>
            <Input id={id("ln")} maxLength={80} autoComplete="off" value={d.lastName} onChange={(e) => set("lastName")(e.target.value)} /></div>
          <div><Label htmlFor={id("dob")}>{t("participants.fields.dob")}</Label>
            <Input id={id("dob")} type="date" value={d.dob} onChange={(e) => set("dob")(e.target.value)} /></div>
          <div><Label htmlFor={id("sex")}>{t("participants.fields.sex")}</Label>
            <Select id={id("sex")} value={d.sex} onChange={(e) => set("sex")(e.target.value)}>
              <option value="">{t("common.select")}</option>
              {SEXES.map((s) => <option key={s} value={s}>{t(`participants.sex.${s}`)}</option>)}
            </Select></div>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-text">{t("participants.someoneElse.guardian")}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor={id("gn")}>{t("participants.someoneElse.guardianName")}</Label>
            <Input id={id("gn")} maxLength={140} autoComplete="off" value={d.guardianName} onChange={(e) => set("guardianName")(e.target.value)} /></div>
          <div><Label htmlFor={id("ge")}>{t("participants.someoneElse.guardianEmail")}</Label>
            <Input id={id("ge")} type="email" maxLength={254} autoComplete="off" value={d.guardianEmail} onChange={(e) => set("guardianEmail")(e.target.value)} /></div>
          <div><Label htmlFor={id("gp")}>{t("participants.someoneElse.guardianPhone")}</Label>
            <Input id={id("gp")} type="tel" maxLength={40} autoComplete="off" value={d.guardianPhone} onChange={(e) => set("guardianPhone")(e.target.value)} /></div>
        </div>
        <p className="text-xs text-text-muted">{t("participants.someoneElse.consentHint")}</p>
      </fieldset>
      <div>
        <Label htmlFor={id("rel")}>{t("participants.someoneElse.relation")}</Label>
        <Select id={id("rel")} value={d.relation} onChange={(e) => set("relation")(e.target.value)}>
          <option value="">{t("common.select")}</option>
          {BOOKER_RELATIONS.map((r) => <option key={r} value={r}>{t(`participants.bookerRelations.${r}`)}</option>)}
        </Select>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="button" loading={busy} onClick={() => void submit()}>{t("participants.someoneElse.submit")}</Button>
      </div>
    </div>
  );
}

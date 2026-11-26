"use client";

import * as React from "react";
import { Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { SEXES } from "@/lib/participants/validation";
import { SportsFields, emptySports, type SportsDraft } from "@/components/participants/sports-fields";

export type ProposalDraft = SportsDraft & { dob: string; sex: string };
export const emptyProposal = (): ProposalDraft => ({ ...emptySports(), dob: "", sex: "" });

/** Only the fields the family filled in (server validates again; nothing applies before approval). */
export function proposalPayload(d: ProposalDraft) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  return Object.keys(out).length ? out : null;
}

/**
 * Optional profile details sent with a club request: sports fields and, if
 * needed, a DOB / sex correction. They stay pending until the club approves;
 * a DOB / sex correction is then reviewed separately by the club's staff.
 */
export function ProposedDetailsFields({ value, onChange, idPrefix }: { value: ProposalDraft; onChange: (v: ProposalDraft) => void; idPrefix: string }) {
  const t = useT();
  return (
    <details className="rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer text-text-secondary">{t("myAthletes.proposal.formTitle")}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-text-muted">{t("myAthletes.proposal.formHint")}</p>
        <SportsFields idPrefix={`${idPrefix}-sp`} value={value} onChange={(s) => onChange({ ...value, ...s })} />
        <div className="grid grid-cols-1 gap-3 border-t border-border-soft pt-3 sm:grid-cols-2">
          <p className="text-xs text-text-muted sm:col-span-2">{t("myAthletes.proposal.correctionHint")}</p>
          <div>
            <Label htmlFor={`${idPrefix}-dob`}>{t("myAthletes.fields.dob")}</Label>
            <Input id={`${idPrefix}-dob`} type="date" value={value.dob} onChange={(e) => onChange({ ...value, dob: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-sex`}>{t("myAthletes.fields.gender")}</Label>
            <Select id={`${idPrefix}-sex`} value={value.sex} onChange={(e) => onChange({ ...value, sex: e.target.value })}>
              <option value="">—</option>
              {SEXES.map((s) => <option key={s} value={s}>{t(`participants.sex.${s}`)}</option>)}
            </Select>
          </div>
        </div>
      </div>
    </details>
  );
}

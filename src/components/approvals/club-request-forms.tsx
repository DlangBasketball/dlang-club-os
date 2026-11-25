"use client";
import * as React from "react";
import { Button, Label, Select, Textarea } from "@/components/ui";
import { useCaAction } from "@/components/club-admin/use-ca-action";
import { submitClubRequest } from "@/lib/actions/club-approval";
import { useT } from "@/lib/i18n/client";
import { AthletePickerField, initialAthlete, type AthleteChoices } from "@/components/participants/athlete-picker-field";
import { acceptsAdults } from "@/lib/participants/active-athlete";
import { ProposedDetailsFields, emptyProposal, proposalPayload, type ProposalDraft } from "./proposed-details-fields";

type Opt = { id: string; name: string };

function useRequestId() {
  const ref = React.useRef(crypto.randomUUID());
  return { current: () => ref.current, renew: () => { ref.current = crypto.randomUUID(); } };
}

/**
 * Parent: "Join the club". Saved as a request pending club approval; the club
 * confirms it and only then creates the membership and its invoice with the
 * club's usual rules. A person membership uses the shared athlete picker
 * (children; "Myself" for adults when the type accepts adults).
 */
export function JoinClubRequestForm({ types, families, choices, active, today }: {
  types: (Opt & { scope: "person" | "family"; price: string; maxAge?: number | null })[]; families: Opt[];
  choices: AthleteChoices; active: string | null; today: string;
}) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const rid = useRequestId();
  const [typeId, setTypeId] = React.useState(types[0]?.id ?? "");
  const [familyId, setFamilyId] = React.useState(families[0]?.id ?? "");
  const [athleteId, setAthleteId] = React.useState(() => initialAthlete(active, choices.participants.filter((p) => p.kind !== "other" && p.kind !== "linked").map((p) => p.id)));
  const [message, setMessage] = React.useState("");
  const [proposal, setProposal] = React.useState<ProposalDraft>(emptyProposal);
  const type = types.find((x) => x.id === typeId);
  if (!types.length || (!families.length && !choices.participants.length)) return <p className="text-sm text-text-muted">{t("clubadmin.membership.noTypes")}</p>;
  const person = type?.scope === "person";
  const ready = !!typeId && (person ? !!athleteId : !!familyId);
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">{t("approvals.join.intro")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor="jr-type">{t("clubadmin.membership.type")}</Label>
          <Select id="jr-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.price}</option>)}
          </Select></div>
        {!person && families.length > 1 && (
          <div><Label htmlFor="jr-family">{t("clubadmin.common.family")}</Label>
            <Select id="jr-family" value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
              {families.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select></div>
        )}
      </div>
      {person && (
        <AthletePickerField idPrefix="jr-child" legend={t("myAthletes.picker.legend")} choices={choices} value={athleteId}
          onChange={(id) => setAthleteId(id)} activityDate={today} allowSelf={acceptsAdults(type?.maxAge)} />
      )}
      {person && athleteId && <ProposedDetailsFields idPrefix="jr-prop" value={proposal} onChange={setProposal} />}
      <div><Label htmlFor="jr-msg">{t("approvals.join.message")}</Label>
        <Textarea id="jr-msg" rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
      <p className="text-xs text-text-muted">{t("approvals.join.noInvoice")}</p>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} disabled={!ready}
          onClick={() => run(() => submitClubRequest({
            kind: "membership", familyId: person ? null : familyId, membershipTypeId: typeId, athleteId: person ? athleteId : null,
            message, profile: person ? proposalPayload(proposal) : null, requestId: rid.current(),
          }), () => { rid.renew(); setMessage(""); setProposal(emptyProposal()); })}>
          {t("approvals.join.submit")}
        </Button>
        {note}
      </div>
    </div>
  );
}

/**
 * Parent: request a place for an athlete in a club programme (pending club
 * approval). Optional profile details travel with the request and are applied
 * only when the club approves.
 */
export function ClubProgramRequestForm({ programId, choices, active, activityDate, allowSelf }: {
  programId: string; choices: AthleteChoices; active: string | null; activityDate: string; allowSelf: boolean;
}) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const rid = useRequestId();
  const offered = choices.participants.filter((p) => p.kind === "child" || (allowSelf && p.kind === "self")).map((p) => p.id);
  const [athleteId, setAthleteId] = React.useState(() => initialAthlete(active, offered));
  const [message, setMessage] = React.useState("");
  const [proposal, setProposal] = React.useState<ProposalDraft>(emptyProposal);
  return (
    <div className="space-y-3">
      <AthletePickerField idPrefix={`pr-child-${programId}`} legend={t("myAthletes.picker.legend")} choices={choices} value={athleteId}
        onChange={(id) => setAthleteId(id)} activityDate={activityDate} allowSelf={allowSelf} />
      {athleteId && <ProposedDetailsFields idPrefix={`pr-prop-${programId}`} value={proposal} onChange={setProposal} />}
      <div><Label htmlFor={`pr-msg-${programId}`}>{t("approvals.join.message")}</Label>
        <Textarea id={`pr-msg-${programId}`} rows={1} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" loading={busy} disabled={!athleteId}
          onClick={() => athleteId && run(() => submitClubRequest({
            kind: "program_registration", athleteId, programId, message, profile: proposalPayload(proposal), requestId: rid.current(),
          }), () => { rid.renew(); setMessage(""); setProposal(emptyProposal()); })}>
          {t("approvals.programs.submit")}
        </Button>
        {note}
      </div>
    </div>
  );
}

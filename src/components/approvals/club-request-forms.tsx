"use client";
import * as React from "react";
import { Button, Label, Select, Textarea } from "@/components/ui";
import { useCaAction } from "@/components/club-admin/use-ca-action";
import { submitClubRequest } from "@/lib/actions/club-approval";
import { useT } from "@/lib/i18n/client";

type Opt = { id: string; name: string };
type Kid = Opt & { familyId: string };

function useRequestId() {
  const ref = React.useRef(crypto.randomUUID());
  return { current: () => ref.current, renew: () => { ref.current = crypto.randomUUID(); } };
}

/**
 * Parent: "Join the club". Saved as a request pending club approval; the club
 * confirms it and only then creates the membership and its invoice with the
 * club's usual rules.
 */
export function JoinClubRequestForm({ types, families, kids: allKids }: {
  types: (Opt & { scope: "person" | "family"; price: string })[]; families: Opt[]; kids: Kid[];
}) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const rid = useRequestId();
  const [typeId, setTypeId] = React.useState(types[0]?.id ?? "");
  const [familyId, setFamilyId] = React.useState(families[0]?.id ?? "");
  const [athleteId, setAthleteId] = React.useState("");
  const [message, setMessage] = React.useState("");
  const type = types.find((x) => x.id === typeId);
  const kids = allKids.filter((c) => c.familyId === familyId);
  if (!types.length || !families.length) return <p className="text-sm text-text-muted">{t("clubadmin.membership.noTypes")}</p>;
  const ready = !!typeId && (type?.scope !== "person" || !!athleteId);
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">{t("approvals.join.intro")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label htmlFor="jr-type">{t("clubadmin.membership.type")}</Label>
          <Select id="jr-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.price}</option>)}
          </Select></div>
        {families.length > 1 && (
          <div><Label htmlFor="jr-family">{t("clubadmin.common.family")}</Label>
            <Select id="jr-family" value={familyId} onChange={(e) => { setFamilyId(e.target.value); setAthleteId(""); }}>
              {families.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select></div>
        )}
        {type?.scope === "person" && (
          <div><Label htmlFor="jr-child">{t("clubadmin.common.child")}</Label>
            <Select id="jr-child" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              <option value="">—</option>{kids.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select></div>
        )}
      </div>
      <div><Label htmlFor="jr-msg">{t("approvals.join.message")}</Label>
        <Textarea id="jr-msg" rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
      <p className="text-xs text-text-muted">{t("approvals.join.noInvoice")}</p>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} disabled={!ready}
          onClick={() => run(() => submitClubRequest({
            kind: "membership", familyId, membershipTypeId: typeId, athleteId: type?.scope === "person" ? athleteId : null,
            message, requestId: rid.current(),
          }), () => { rid.renew(); setMessage(""); })}>
          {t("approvals.join.submit")}
        </Button>
        {note}
      </div>
    </div>
  );
}

/** Parent: request a place for a child in a club programme (pending club approval). */
export function ClubProgramRequestForm({ programId, kids }: { programId: string; kids: Kid[] }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const rid = useRequestId();
  const [athleteId, setAthleteId] = React.useState(kids.length === 1 ? kids[0].id : "");
  const [message, setMessage] = React.useState("");
  const kid = kids.find((k) => k.id === athleteId);
  if (!kids.length) return <p className="text-sm text-text-muted">{t("approvals.programs.noChildren")}</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor={`pr-child-${programId}`}>{t("clubadmin.common.child")}</Label>
          <Select id={`pr-child-${programId}`} value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
            <option value="">—</option>{kids.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor={`pr-msg-${programId}`}>{t("approvals.join.message")}</Label>
          <Textarea id={`pr-msg-${programId}`} rows={1} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" loading={busy} disabled={!kid}
          onClick={() => kid && run(() => submitClubRequest({
            kind: "program_registration", familyId: kid.familyId, athleteId: kid.id, programId, message, requestId: rid.current(),
          }), () => { rid.renew(); setMessage(""); })}>
          {t("approvals.programs.submit")}
        </Button>
        {note}
      </div>
    </div>
  );
}

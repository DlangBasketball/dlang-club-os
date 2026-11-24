"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldQuestion, UserPlus } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { createParticipant, requestParticipantLink } from "@/lib/actions/participants";
import { LINK_RELATIONS, SEXES, type ParticipantOption } from "@/lib/participants/validation";
import { PortalDialog, useRequestId } from "./portal-dialog";
import { SportsFields, emptySports, type SportsDraft } from "./sports-fields";

type Draft = { firstName: string; lastName: string; dob: string; sex: string };
const emptyDraft = (): Draft => ({ firstName: "", lastName: "", dob: "", sex: "" });

/**
 * "Add a child" / "Add a participant": a child of the signed-in adult's
 * family. Opens over the current page (portal), so a booking in progress
 * keeps its activity, dates and options. When the club may already know the
 * child, NOTHING about the existing record is shown: the adult chooses
 * "Request link" (the child's guardians or the club confirm) or "This is a
 * different child" (a new profile the club double-checks).
 */
export function AddParticipantDialog({ open, onClose, onCreated, title }: {
  open: boolean; onClose: () => void; onCreated: (p: ParticipantOption) => void; title?: string;
}) {
  const t = useT();
  const [d, setD] = React.useState<Draft>(emptyDraft);
  const [sports, setSports] = React.useState<SportsDraft>(emptySports);
  const [more, setMore] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<"form" | "match" | "linked">("form");
  const [relation, setRelation] = React.useState<(typeof LINK_RELATIONS)[number]>("guardian");
  const [createId, resetCreateId] = useRequestId();
  const [linkId, resetLinkId] = useRequestId();

  function reset() {
    setD(emptyDraft()); setSports(emptySports()); setMore(false); setErr(null); setStage("form"); setBusy(false);
    resetCreateId(); resetLinkId();
  }
  function close() { reset(); onClose(); }
  const set = (k: keyof Draft) => (v: string) => { setErr(null); setD((x) => ({ ...x, [k]: v })); };

  async function create(decision?: "different") {
    setBusy(true); setErr(null);
    const res = await createParticipant({ ...d, sex: d.sex as (typeof SEXES)[number], ...sports, ...(decision ? { decision } : {}) }, createId());
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    if (res.data.status === "possible_match") { setStage("match"); return; }
    onCreated(res.data.participant);
    reset();
    onClose();
  }

  async function link() {
    setBusy(true); setErr(null);
    const res = await requestParticipantLink({ firstName: d.firstName, lastName: d.lastName, dob: d.dob, relation }, linkId());
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setStage("linked");
  }

  const canSubmit = d.firstName.trim() && d.lastName.trim() && d.dob && d.sex && !busy;

  return (
    <PortalDialog open={open} onClose={close} title={title ?? t("participants.add.title")} size="lg">
      {stage === "form" && (
        <div className="space-y-4" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); if (canSubmit) void create(); } }}>
          <p className="text-sm text-text-muted">{t("participants.add.intro")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor="pa-fn">{t("participants.fields.firstName")}</Label>
              <Input id="pa-fn" required maxLength={80} autoComplete="off" value={d.firstName} onChange={(e) => set("firstName")(e.target.value)} /></div>
            <div><Label htmlFor="pa-ln">{t("participants.fields.lastName")}</Label>
              <Input id="pa-ln" required maxLength={80} autoComplete="off" value={d.lastName} onChange={(e) => set("lastName")(e.target.value)} /></div>
            <div><Label htmlFor="pa-dob">{t("participants.fields.dob")}</Label>
              <Input id="pa-dob" type="date" required value={d.dob} onChange={(e) => set("dob")(e.target.value)} /></div>
            <div><Label htmlFor="pa-sex">{t("participants.fields.sex")}</Label>
              <Select id="pa-sex" required value={d.sex} onChange={(e) => set("sex")(e.target.value)}>
                <option value="">{t("common.select")}</option>
                {SEXES.map((s) => <option key={s} value={s}>{t(`participants.sex.${s}`)}</option>)}
              </Select></div>
          </div>
          <button type="button" className="text-sm text-brand-primary hover:underline" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            {more ? t("participants.add.lessDetails") : t("participants.add.moreDetails")}
          </button>
          {more && <SportsFields value={sports} onChange={setSports} idPrefix="pa-sp" />}
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>{t("common.cancel")}</Button>
            <Button type="button" loading={busy} disabled={!canSubmit} onClick={() => void create()}>
              <UserPlus className="h-4 w-4" aria-hidden /> {t("participants.add.submit")}
            </Button>
          </div>
        </div>
      )}

      {stage === "match" && (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-md border border-border bg-surface-elevated p-3">
            <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-brand-accent" aria-hidden />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-text">{t("participants.match.title")}</p>
              <p className="text-text-muted">{t("participants.match.body")}</p>
            </div>
          </div>
          <div>
            <Label htmlFor="pa-rel">{t("participants.link.relation")}</Label>
            <Select id="pa-rel" value={relation} onChange={(e) => setRelation(e.target.value as (typeof LINK_RELATIONS)[number])}>
              {LINK_RELATIONS.map((r) => <option key={r} value={r}>{t(`participants.relations.${r}`)}</option>)}
            </Select>
          </div>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void create("different")}>{t("participants.match.different")}</Button>
            <Button type="button" loading={busy} onClick={() => void link()}>{t("participants.match.requestLink")}</Button>
          </div>
          <p className="text-xs text-text-muted">{t("participants.match.differentHint")}</p>
        </div>
      )}

      {stage === "linked" && (
        <div className="space-y-4">
          <p role="status" className="text-sm text-text">{t("participants.link.sentBody")}</p>
          <div className="flex justify-end"><Button type="button" onClick={close}>{t("common.close")}</Button></div>
        </div>
      )}
    </PortalDialog>
  );
}

/** Button + dialog; after a child is added the page data refreshes (client state is kept). */
export function AddParticipantButton({ label, variant = "secondary", onCreated }: {
  label?: string; variant?: "primary" | "secondary" | "outline" | "ghost"; onCreated?: (p: ParticipantOption) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" variant={variant} size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" aria-hidden /> {label ?? t("participants.add.child")}
      </Button>
      <AddParticipantDialog open={open} onClose={() => setOpen(false)}
        onCreated={(p) => { onCreated?.(p); router.refresh(); }} />
    </>
  );
}

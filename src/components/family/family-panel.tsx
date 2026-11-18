"use client";

import * as React from "react";
import { UserPlus, Users, Wallet } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useFormat, useT } from "@/lib/i18n/client";
import { inviteSecondGuardian, removeGuardian, revokeGuardianInvite, setBillingSplit, setGuardianPermissions } from "@/lib/actions/guardians";
import { evenShares, splitAmount, validateShares } from "@/lib/family/split";
import type { FamilyPanel, GuardianView } from "@/lib/family/data";
import { StatusLine, useFamilyAction } from "./use-family-action";

const RELATIONS = ["mother", "father", "guardian", "partner", "grandparent", "other"] as const;

function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-text-secondary">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="block text-xs text-text-muted">{hint}</span>}</span>
    </label>
  );
}

function GuardianRow({ familyId, g, manage }: { familyId: string; g: GuardianView; manage: boolean }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [perm, setPerm] = React.useState({ canPay: g.canPay, canSeeMedical: g.canSeeMedical, receivesEmails: g.receivesEmails });
  const editable = manage && !g.isPrimary;
  const dirty = perm.canPay !== g.canPay || perm.canSeeMedical !== g.canSeeMedical || perm.receivesEmails !== g.receivesEmails;
  return (
    <li className="space-y-2 border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-text">{g.name}</span>
        {g.relation && <span className="text-xs text-text-muted">{t.dynamic(`family.relations.${g.relation}`, {}, g.relation)}</span>}
        {g.isPrimary && <Badge tone="brand">{t("family.guardians.primary")}</Badge>}
        {g.isMe && <Badge>{t("family.guardians.you")}</Badge>}
        {g.sharePct !== null && <Badge tone="accent">{t("family.split.sharePct", { pct: g.sharePct })}</Badge>}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        <Check label={t("family.permissions.canPay")} checked={perm.canPay} disabled={!editable || busy} onChange={(v) => setPerm((p) => ({ ...p, canPay: v }))} />
        <Check label={t("family.permissions.canSeeMedical")} checked={perm.canSeeMedical} disabled={!editable || busy} onChange={(v) => setPerm((p) => ({ ...p, canSeeMedical: v }))} />
        <Check label={t("family.permissions.receivesEmails")} checked={perm.receivesEmails} disabled={!editable || busy} onChange={(v) => setPerm((p) => ({ ...p, receivesEmails: v }))} />
      </div>
      <div className="flex flex-wrap gap-2">
        {editable && dirty && (
          <Button size="sm" loading={busy} disabled={busy} onClick={() => run(() => setGuardianPermissions({ familyId, profileId: g.profileId, ...perm }))}>
            {t("common.save")}
          </Button>
        )}
        {!g.isPrimary && (manage || g.isMe) && (
          <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => { if (window.confirm(g.isMe ? t("family.guardians.leaveConfirm") : t("family.guardians.removeConfirm", { name: g.name }))) void run(() => removeGuardian({ familyId, profileId: g.profileId })); }}>
            {g.isMe ? t("family.guardians.leave") : t("family.guardians.remove")}
          </Button>
        )}
      </div>
      <StatusLine msg={msg} />
    </li>
  );
}

function InviteForm({ familyId }: { familyId: string }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [email, setEmail] = React.useState("");
  const [relation, setRelation] = React.useState<(typeof RELATIONS)[number]>("guardian");
  const [perm, setPerm] = React.useState({ canPay: true, canSeeMedical: true, receivesEmails: true });
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await run(() => inviteSecondGuardian({ familyId, email, relation, permissions: perm }))) setEmail("");
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`inv-email-${familyId}`}>{t("family.invite.email")}</Label>
          <Input id={`inv-email-${familyId}`} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`inv-rel-${familyId}`}>{t("family.invite.relation")}</Label>
          <Select id={`inv-rel-${familyId}`} value={relation} onChange={(e) => setRelation(e.target.value as (typeof RELATIONS)[number])}>
            {RELATIONS.map((r) => <option key={r} value={r}>{t(`family.relations.${r}`)}</option>)}
          </Select>
        </div>
      </div>
      <fieldset className="grid gap-1.5 sm:grid-cols-3">
        <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("family.invite.permissions")}</legend>
        <Check label={t("family.permissions.canPay")} checked={perm.canPay} onChange={(v) => setPerm((p) => ({ ...p, canPay: v }))} />
        <Check label={t("family.permissions.canSeeMedical")} checked={perm.canSeeMedical} onChange={(v) => setPerm((p) => ({ ...p, canSeeMedical: v }))} />
        <Check label={t("family.permissions.receivesEmails")} checked={perm.receivesEmails} onChange={(v) => setPerm((p) => ({ ...p, receivesEmails: v }))} />
      </fieldset>
      <FieldHint>{t("family.invite.hint")}</FieldHint>
      <StatusLine msg={msg} />
      <Button type="submit" loading={busy} disabled={busy}>{t("family.invite.send")}</Button>
    </form>
  );
}

function SplitForm({ family }: { family: FamilyPanel }) {
  const t = useT();
  const f = useFormat();
  const { busy, msg, run, setMsg } = useFamilyAction();
  const payers = family.guardians.filter((g) => g.canPay);
  const [mode, setMode] = React.useState<"single" | "split">(family.splitMode);
  const [pcts, setPcts] = React.useState<Record<string, string>>(() => {
    const start = family.splitMode === "split" ? payers.map((g) => ({ profileId: g.profileId, pct: g.sharePct ?? 0 })) : evenShares(payers.map((g) => g.profileId));
    return Object.fromEntries(start.map((s) => [s.profileId, String(s.pct)]));
  });
  const shares = payers.map((g) => ({ profileId: g.profileId, pct: Number(pcts[g.profileId] ?? 0) }));
  const problem = mode === "split" ? validateShares(shares) : null;
  const example = splitAmount(100, shares.map((s) => s.pct));
  if (payers.length < 2) return <p className="text-sm text-text-muted">{t("family.split.needTwo")}</p>;
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (problem) return setMsg({ ok: false, text: t.dynamic(`family.split.problem.${problem}`) });
      await run(() => setBillingSplit({ familyId: family.id, mode, shares: mode === "split" ? shares : [] }));
    }}>
      <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
        <label className="flex items-center gap-2"><input type="radio" name={`mode-${family.id}`} checked={mode === "single"} onChange={() => setMode("single")} /> {t("family.split.single")}</label>
        <label className="flex items-center gap-2"><input type="radio" name={`mode-${family.id}`} checked={mode === "split"} onChange={() => setMode("split")} /> {t("family.split.split")}</label>
      </div>
      {mode === "split" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {payers.map((g) => (
              <div key={g.profileId}>
                <Label htmlFor={`pct-${family.id}-${g.profileId}`}>{t("family.split.shareOf", { name: g.name })}</Label>
                <Input id={`pct-${family.id}-${g.profileId}`} type="number" min={0} max={100} step={0.01} inputMode="decimal"
                  value={pcts[g.profileId] ?? ""} onChange={(e) => setPcts((p) => ({ ...p, [g.profileId]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setPcts(Object.fromEntries(evenShares(payers.map((g) => g.profileId)).map((s) => [s.profileId, String(s.pct)])))}>
              {t("family.split.even")}
            </Button>
            {!problem && (
              <span className="text-xs text-text-muted">
                {t("family.split.example", { amount: f.money(100), parts: example.map((a) => f.money(a)).join(" + ") })}
              </span>
            )}
          </div>
          {problem && <p className="text-sm text-warning">{t.dynamic(`family.split.problem.${problem}`)}</p>}
          <FieldHint>{t("family.split.hint")}</FieldHint>
        </>
      )}
      <StatusLine msg={msg} />
      <Button type="submit" loading={busy} disabled={busy}>{t("common.save")}</Button>
    </form>
  );
}

function PendingInvites({ family }: { family: FamilyPanel }) {
  const t = useT();
  const f = useFormat();
  const { busy, msg, run } = useFamilyAction();
  if (!family.pendingInvites.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("family.invite.pending")}</h3>
      <ul className="space-y-1.5 text-sm">
        {family.pendingInvites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-text">{i.email} <span className="text-xs text-text-muted">· {f.date(i.createdAt)}</span></span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => revokeGuardianInvite(i.id))}>{t("family.invite.revoke")}</Button>
          </li>
        ))}
      </ul>
      <StatusLine msg={msg} />
    </div>
  );
}

/** Parent app: guardians of each family, their permissions, invites and the billing split. */
export function FamilyPanels({ families }: { families: FamilyPanel[] }) {
  const t = useT();
  return (
    <div className="space-y-6">
      {families.map((fam) => (
        <div key={fam.id} className="space-y-4">
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Users aria-hidden className="h-4 w-4 text-brand-primary" />
              <CardTitle>{t("family.guardians.title", { family: fam.name })}</CardTitle>
            </CardHeader>
            <CardBody>
              {fam.children.length > 0 && (
                <p className="mb-2 text-sm text-text-muted">{t("family.guardians.children", { names: fam.children.map((c) => c.name).join(", ") })}</p>
              )}
              <ul>{fam.guardians.map((g) => <GuardianRow key={g.profileId} familyId={fam.id} g={g} manage={fam.iAmPrimary} />)}</ul>
              {!fam.iAmPrimary && <p className="mt-2 text-xs text-text-muted">{t("family.guardians.onlyPrimary")}</p>}
            </CardBody>
          </Card>
          {fam.iAmPrimary && (
            <Card>
              <CardHeader className="flex items-center gap-2">
                <UserPlus aria-hidden className="h-4 w-4 text-brand-primary" />
                <CardTitle>{t("family.invite.title")}</CardTitle>
              </CardHeader>
              <CardBody className="space-y-5">
                <InviteForm familyId={fam.id} />
                <PendingInvites family={fam} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Wallet aria-hidden className="h-4 w-4 text-brand-primary" />
              <CardTitle>{t("family.split.title")}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-sm text-text-muted">{t("family.split.intro")}</p>
              {fam.iAmPrimary ? <SplitForm family={fam} /> : (
                <p className="text-sm text-text-secondary">
                  {fam.splitMode === "split"
                    ? t("family.split.current", { shares: fam.guardians.filter((g) => g.sharePct).map((g) => `${g.name} ${g.sharePct}%`).join(" · ") })
                    : t("family.split.singleCurrent")}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      ))}
    </div>
  );
}

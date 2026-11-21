"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { sponsorFamilyPlayers, updateAthleteSponsorship } from "@/lib/actions/sponsorship";
import { Button, Input, Label, Select, Textarea, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import {
  DEFAULT_SPONSORSHIP_SCOPE,
  SPONSORSHIP_KINDS,
  SPONSORSHIP_SCOPES,
  type Sponsorship,
  type SponsorshipKind,
  type SponsorshipScope,
} from "@/lib/people/sponsorship";

type Target = { athleteId: string } | { familyId: string };

/**
 * Sponsorship editor (admin / finance): kind, share, fees covered, sponsor,
 * internal reason, validity. For one player, or every player of a family
 * (the family shortcut). The server action validates with zod; the database
 * guard enforces staff-only writes.
 */
export function SponsorshipFields({ target, initial, onDone }: { target: Target; initial?: Sponsorship | null; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const id = React.useId();
  const [kind, setKind] = React.useState<SponsorshipKind>(initial?.kind ?? "none");
  const [percent, setPercent] = React.useState(initial?.kind === "partial" && initial.percent !== null ? String(initial.percent) : "");
  const [scope, setScope] = React.useState<SponsorshipScope[]>(initial?.scope?.length ? initial.scope : DEFAULT_SPONSORSHIP_SCOPE);
  const [sponsorName, setSponsorName] = React.useState(initial?.sponsorName ?? "");
  const [reason, setReason] = React.useState(initial?.reason ?? "");
  const [from, setFrom] = React.useState(initial?.from ?? "");
  const [until, setUntil] = React.useState(initial?.until ?? "");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = React.useState(false);
  const active = kind !== "none";

  function toggle(s: SponsorshipScope) {
    setScope((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const input = { kind, percent, scope, sponsorName, reason, from, until };
    const res = "athleteId" in target ? await updateAthleteSponsorship(target.athleteId, input) : await sponsorFamilyPlayers(target.familyId, input);
    setPending(false);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("sponsorship.saved") });
      router.refresh();
      onDone?.();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-kind`}>{t("sponsorship.kind")}</Label>
          <Select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as SponsorshipKind)}>
            {SPONSORSHIP_KINDS.map((k) => <option key={k} value={k}>{t(`sponsorship.kinds.${k}`)}</option>)}
          </Select>
        </div>
        {kind === "partial" && (
          <div>
            <Label htmlFor={`${id}-pct`}>{t("sponsorship.percent")}</Label>
            <Input id={`${id}-pct`} inputMode="decimal" maxLength={6} required value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
        )}
      </div>

      {active && (
        <>
          <fieldset>
            <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("sponsorship.scope")}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SPONSORSHIP_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" className="h-4 w-4 accent-brand-primary" checked={scope.includes(s)} onChange={() => toggle(s)} />
                  {t(`sponsorship.scopes.${s}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor={`${id}-sponsor`}>{t("sponsorship.sponsorName")}</Label>
            <Input id={`${id}-sponsor`} maxLength={120} placeholder={t("sponsorship.sponsorNamePlaceholder")} value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`${id}-reason`}>{t("sponsorship.reason")}</Label>
            <Textarea id={`${id}-reason`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${id}-from`}>{t("sponsorship.from")}</Label>
              <Input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`${id}-until`}>{t("sponsorship.until")}</Label>
              <Input id={`${id}-until`} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
              <FieldHint>{t("sponsorship.untilHint")}</FieldHint>
            </div>
          </div>
        </>
      )}
      <p className="text-xs text-text-muted">{t("sponsorship.hint")}</p>
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      <Button type="submit" loading={pending}>
        {pending ? t("sponsorship.saving") : "familyId" in target ? t("sponsorship.family.submit") : t("sponsorship.save")}
      </Button>
    </form>
  );
}

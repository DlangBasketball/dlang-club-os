"use client";

import * as React from "react";
import { Button, Input, Label, Select, Textarea, FieldHint } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import {
  cancelMembership, createMembership, joinMembership, renewMembership, saveMembershipType, sendRenewalReminders,
} from "@/lib/actions/club-admin-membership";
import { MEMBERSHIP_KINDS } from "@/lib/club-admin/membership";
import { useCaAction } from "./use-ca-action";

type Opt = { id: string; name: string };

export type TypeFormValue = {
  id: string | null; name: string; description: string; kind: (typeof MEMBERSHIP_KINDS)[number]; scope: "person" | "family";
  price: string; currency: string; period: "season" | "calendar_year"; seasonStartMonth: string; minAge: string; maxAge: string;
  isActive: boolean; sort: string;
};

export function MembershipTypeForm({ initial }: { initial: TypeFormValue }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [v, setV] = React.useState(initial);
  const set = <K extends keyof TypeFormValue>(k: K, val: TypeFormValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const p = v.id ?? "new";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><Label htmlFor={`mt-name-${p}`}>{t("clubadmin.membership.typeName")}</Label>
          <Input id={`mt-name-${p}`} maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><Label htmlFor={`mt-kind-${p}`}>{t("clubadmin.membership.kind")}</Label>
          <Select id={`mt-kind-${p}`} value={v.kind} onChange={(e) => set("kind", e.target.value as TypeFormValue["kind"])}>
            {MEMBERSHIP_KINDS.map((k) => <option key={k} value={k}>{t.dynamic(`clubadmin.membership.kinds.${k}`, undefined, k)}</option>)}
          </Select></div>
        <div><Label htmlFor={`mt-scope-${p}`}>{t("clubadmin.membership.scope")}</Label>
          <Select id={`mt-scope-${p}`} value={v.scope} onChange={(e) => set("scope", e.target.value as TypeFormValue["scope"])}>
            <option value="person">{t("clubadmin.membership.scopes.person")}</option>
            <option value="family">{t("clubadmin.membership.scopes.family")}</option>
          </Select></div>
        <div><Label htmlFor={`mt-price-${p}`}>{t("clubadmin.membership.price")}</Label>
          <Input id={`mt-price-${p}`} inputMode="decimal" value={v.price} onChange={(e) => set("price", e.target.value)} /></div>
        <div><Label htmlFor={`mt-cur-${p}`}>{t("clubadmin.membership.currency")}</Label>
          <Input id={`mt-cur-${p}`} maxLength={3} className="uppercase" value={v.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
        <div><Label htmlFor={`mt-period-${p}`}>{t("clubadmin.membership.period")}</Label>
          <Select id={`mt-period-${p}`} value={v.period} onChange={(e) => set("period", e.target.value as TypeFormValue["period"])}>
            <option value="season">{t("clubadmin.membership.periods.season")}</option>
            <option value="calendar_year">{t("clubadmin.membership.periods.calendar_year")}</option>
          </Select></div>
        {v.period === "season" && (
          <div><Label htmlFor={`mt-month-${p}`}>{t("clubadmin.membership.seasonStartMonth")}</Label>
            <Input id={`mt-month-${p}`} type="number" min={1} max={12} value={v.seasonStartMonth} onChange={(e) => set("seasonStartMonth", e.target.value)} /></div>
        )}
        <div><Label htmlFor={`mt-min-${p}`}>{t("clubadmin.membership.minAge")}</Label>
          <Input id={`mt-min-${p}`} type="number" min={0} max={120} value={v.minAge} onChange={(e) => set("minAge", e.target.value)} /></div>
        <div><Label htmlFor={`mt-max-${p}`}>{t("clubadmin.membership.maxAge")}</Label>
          <Input id={`mt-max-${p}`} type="number" min={0} max={120} value={v.maxAge} onChange={(e) => set("maxAge", e.target.value)} /></div>
      </div>
      <div><Label htmlFor={`mt-desc-${p}`}>{t("clubadmin.membership.description")}</Label>
        <Textarea id={`mt-desc-${p}`} rows={2} maxLength={1000} value={v.description} onChange={(e) => set("description", e.target.value)} /></div>
      <label htmlFor={`mt-act-${p}`} className="flex items-center gap-2 text-sm text-ink-2">
        <input id={`mt-act-${p}`} type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} /> {t("clubadmin.membership.active")}
      </label>
      <FieldHint>{t("clubadmin.membership.typeHint")}</FieldHint>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} onClick={() => run(() => saveMembershipType(v.id, {
          name: v.name, description: v.description, kind: v.kind, scope: v.scope, price: v.price, currency: v.currency,
          period: v.period, seasonStartMonth: Number(v.seasonStartMonth || 8), minAge: v.minAge, maxAge: v.maxAge, isActive: v.isActive, sort: Number(v.sort || 0),
        }), () => { if (!v.id) setV(initial); })}>{t("common.save")}</Button>
        {note}
      </div>
    </div>
  );
}

export function CreateMembershipForm({ types, families, athletes, today }: {
  types: (Opt & { scope: "person" | "family" })[]; families: Opt[]; athletes: (Opt & { familyId: string })[]; today: string;
}) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [typeId, setTypeId] = React.useState(types[0]?.id ?? "");
  const [familyId, setFamilyId] = React.useState("");
  const [athleteId, setAthleteId] = React.useState("");
  const [from, setFrom] = React.useState(today);
  const [free, setFree] = React.useState(false);
  const scope = types.find((x) => x.id === typeId)?.scope ?? "person";
  const kids = athletes.filter((a) => a.familyId === familyId);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div><Label htmlFor="cm-type">{t("clubadmin.membership.type")}</Label>
          <Select id="cm-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor="cm-family">{t("clubadmin.common.family")}</Label>
          <Select id="cm-family" value={familyId} onChange={(e) => { setFamilyId(e.target.value); setAthleteId(""); }}>
            <option value="">—</option>{families.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        {scope === "person" && (
          <div><Label htmlFor="cm-athlete">{t("clubadmin.common.athlete")}</Label>
            <Select id="cm-athlete" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              <option value="">—</option>{kids.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select></div>
        )}
        <div><Label htmlFor="cm-from">{t("clubadmin.membership.validFrom")}</Label>
          <Input id="cm-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      </div>
      <label htmlFor="cm-free" className="flex items-center gap-2 text-sm text-ink-2">
        <input id="cm-free" type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> {t("clubadmin.membership.free")}
      </label>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} disabled={!typeId || !familyId}
          onClick={() => run(() => createMembership({ typeId, familyId, athleteId: scope === "person" ? athleteId : null, validFrom: from, free }))}>
          {t("clubadmin.membership.enrol")}
        </Button>
        {note}
      </div>
    </div>
  );
}

export function RenewalCampaign({ rows }: { rows: { id: string; label: string; until: string; reminded: string | null }[] }) {
  const t = useT();
  const f = useFormat();
  const { busy, run, note } = useCaAction();
  const [sel, setSel] = React.useState<Set<string>>(new Set(rows.map((r) => r.id)));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <label htmlFor={`rc-${r.id}`} className="flex items-center gap-2">
              <input id={`rc-${r.id}`} type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /> {r.label}
            </label>
            <span className="text-xs text-ink-3">
              {t("clubadmin.membership.endsOn", { date: f.date(r.until) })}
              {r.reminded ? ` · ${t("clubadmin.membership.remindedOn", { date: f.date(r.reminded) })}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} disabled={sel.size === 0} onClick={() => run(() => sendRenewalReminders(Array.from(sel)))}>
          {t("clubadmin.membership.sendReminders", { count: sel.size })}
        </Button>
        {note}
      </div>
    </div>
  );
}

export function MembershipRowActions({ id, canRenew, canCancel }: { id: string; canRenew: boolean; canCancel: boolean }) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [reason, setReason] = React.useState("");
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRenew && <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => renewMembership(id))}>{t("clubadmin.membership.renew")}</Button>}
      {canCancel && !open && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{t("clubadmin.membership.cancel")}</Button>}
      {open && (
        <span className="flex items-center gap-2">
          <label htmlFor={`mc-${id}`} className="sr-only">{t("clubadmin.common.reason")}</label>
          <Input id={`mc-${id}`} className="h-8 w-48" placeholder={t("clubadmin.common.reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="danger" loading={busy} onClick={() => run(() => cancelMembership(id, reason))}>{t("clubadmin.common.confirm")}</Button>
        </span>
      )}
      {note}
    </div>
  );
}

/** Parent: join the club (person type -> pick a child). */
export function ParentJoinForm({ types, families, kids: allKids }: {
  types: (Opt & { scope: "person" | "family"; price: string })[]; families: Opt[]; kids: (Opt & { familyId: string })[];
}) {
  const t = useT();
  const { busy, run, note } = useCaAction();
  const [typeId, setTypeId] = React.useState(types[0]?.id ?? "");
  const [familyId, setFamilyId] = React.useState(families[0]?.id ?? "");
  const [athleteId, setAthleteId] = React.useState("");
  const type = types.find((x) => x.id === typeId);
  const kids = allKids.filter((c) => c.familyId === familyId);
  if (!types.length || !families.length) return <p className="text-sm text-ink-3">{t("clubadmin.membership.noTypes")}</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label htmlFor="pj-type">{t("clubadmin.membership.type")}</Label>
          <Select id="pj-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.price}</option>)}
          </Select></div>
        {families.length > 1 && (
          <div><Label htmlFor="pj-family">{t("clubadmin.common.family")}</Label>
            <Select id="pj-family" value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
              {families.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select></div>
        )}
        {type?.scope === "person" && (
          <div><Label htmlFor="pj-child">{t("clubadmin.common.child")}</Label>
            <Select id="pj-child" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              <option value="">—</option>{kids.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select></div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} disabled={!typeId || (type?.scope === "person" && !athleteId)}
          onClick={() => run(() => joinMembership({ typeId, familyId, athleteId: type?.scope === "person" ? athleteId : null }))}>
          {t("clubadmin.membership.join")}
        </Button>
        {note}
      </div>
    </div>
  );
}

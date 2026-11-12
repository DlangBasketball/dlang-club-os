"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, Label, Select, Textarea } from "@/components/ui";
import { deleteDiscount, saveDiscount, setDiscountActive } from "@/lib/actions/discounts";
import { DISCOUNT_KINDS, DISCOUNT_RULES, DISCOUNT_SCOPES, type DiscountKind, type DiscountRule, type DiscountScope } from "@/lib/pricing/discounts";
import { PROGRAM_CURRENCIES, zonedParts } from "@/lib/club-ops/validation";
import { zonedWallTimeToUtc } from "@/lib/format";
import { useFormat, useT } from "@/lib/i18n/client";

export type DiscountListItem = {
  id: string; name: string; description: string | null; kind: DiscountKind; value: number; currency: string | null;
  scope: DiscountScope; scopeProgramId: string | null; scopeServiceId: string | null; rule: DiscountRule; code: string | null;
  validFrom: string | null; validUntil: string | null; siblingMinPosition: number | null; earlyBirdDaysBefore: number | null;
  maxRedemptions: number | null; maxRedemptionsPerFamily: number | null; stackable: boolean; active: boolean; uses: number;
};
type Opt = { id: string; name: string };
const opt = (s: string): number | "" => (s.trim() === "" ? "" : Number(s));

function toLocal(iso: string | null, tz: string) { const p = zonedParts(iso, tz); return p.date ? `${p.date}T${p.time}` : ""; }
function fromLocal(v: string, tz: string) { if (!v) return ""; const [d, t] = v.split("T"); return zonedWallTimeToUtc(d, t ?? "00:00", tz)?.toISOString() ?? ""; }

export function DiscountManager({ discounts, programs, services, canEdit }: { discounts: DiscountListItem[]; programs: Opt[]; services: Opt[]; canEdit: boolean }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function act(fn: () => Promise<{ ok: boolean; error?: string; disabled?: boolean }>, okText?: string) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "err", text: res.error ?? "" });
    setMsg(res.disabled ? { tone: "ok", text: t("camps.discounts.disabledInstead") } : okText ? { tone: "ok", text: okText } : null);
    router.refresh();
  }

  const valueLabel = (d: DiscountListItem) => (d.kind === "percent" ? f.percent(d.value / 100, 2) : f.money(d.value, d.currency ?? f.currency));
  const scopeLabel = (d: DiscountListItem) =>
    d.scope === "program" ? programs.find((p) => p.id === d.scopeProgramId)?.name ?? t("camps.discounts.scopes.program")
      : d.scope === "service" ? services.find((s) => s.id === d.scopeServiceId)?.name ?? t("camps.discounts.scopes.service")
        : t(`camps.discounts.scopes.${d.scope}`);

  return (
    <div className="space-y-4">
      {canEdit && editing !== "new" && <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> {t("camps.discounts.add")}</Button>}
      {editing === "new" && <Card><CardBody><DiscountForm programs={programs} services={services} onDone={() => setEditing(null)} /></CardBody></Card>}
      {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
      {discounts.length === 0 && editing !== "new" && <p className="text-sm text-ink-3">{t("camps.discounts.empty")}</p>}
      {discounts.map((d) => (
        <Card key={d.id} className={d.active ? undefined : "opacity-70"}>
          <CardBody>
            {editing === d.id ? (
              <DiscountForm programs={programs} services={services} discount={d} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{d.name}</span>
                    <Badge tone={d.active ? "success" : "neutral"}>{d.active ? t("camps.active") : t("camps.inactive")}</Badge>
                    <Badge tone="info">{t(`camps.discounts.rules.${d.rule}`)}</Badge>
                    {d.code && <Badge tone="accent" className="font-mono">{d.code}</Badge>}
                  </div>
                  <div className="text-sm text-ink-2"><span className="tnum">{valueLabel(d)}</span> · {scopeLabel(d)}</div>
                  <div className="text-xs text-ink-3">
                    {d.rule === "sibling" && t("camps.discounts.siblingLine", { n: d.siblingMinPosition ?? 2 })}
                    {d.rule === "early_bird" && d.earlyBirdDaysBefore != null && t("camps.discounts.earlyBirdLine", { days: d.earlyBirdDaysBefore })}
                    {d.validUntil && <> {t("camps.discounts.validUntilLine", { date: f.dateTime(d.validUntil) })}</>}
                  </div>
                  <div className="text-xs text-ink-3">
                    {d.maxRedemptions != null ? t("camps.discounts.usesOfMax", { uses: d.uses, max: d.maxRedemptions }) : t("camps.discounts.uses", { uses: d.uses })}
                    {d.maxRedemptionsPerFamily != null && <> · {t("camps.discounts.perFamilyLine", { max: d.maxRedemptionsPerFamily })}</>}
                    {!d.stackable && <> · {t("camps.discounts.notStackable")}</>}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(d.id)}><Pencil className="h-4 w-4" /> {t("common.edit")}</Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => setDiscountActive(d.id, !d.active))}><Power className="h-4 w-4" /> {d.active ? t("camps.discounts.disable") : t("camps.discounts.enable")}</Button>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(t("camps.discounts.confirmDelete"))) act(() => deleteDiscount(d.id), t("camps.discounts.deleted")); }}><Trash2 className="h-4 w-4" /> {t("common.delete")}</Button>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function DiscountForm({ discount, programs, services, onDone }: { discount?: DiscountListItem; programs: Opt[]; services: Opt[]; onDone: () => void }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [v, setV] = React.useState({
    name: discount?.name ?? "", description: discount?.description ?? "", kind: discount?.kind ?? ("percent" as DiscountKind),
    value: discount ? String(discount.value) : "", currency: discount?.currency ?? f.currency, scope: discount?.scope ?? ("all" as DiscountScope),
    scopeProgramId: discount?.scopeProgramId ?? "", scopeServiceId: discount?.scopeServiceId ?? "", rule: discount?.rule ?? ("promo_code" as DiscountRule),
    code: discount?.code ?? "", maxRedemptions: discount?.maxRedemptions != null ? String(discount.maxRedemptions) : "",
    maxRedemptionsPerFamily: discount?.maxRedemptionsPerFamily != null ? String(discount.maxRedemptionsPerFamily) : "",
    validFrom: toLocal(discount?.validFrom ?? null, f.timeZone), validUntil: toLocal(discount?.validUntil ?? null, f.timeZone),
    siblingMinPosition: String(discount?.siblingMinPosition ?? 2), earlyBirdDaysBefore: discount?.earlyBirdDaysBefore != null ? String(discount.earlyBirdDaysBefore) : "",
    stackable: discount?.stackable ?? true, isActive: discount?.active ?? true,
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const id = discount?.id ?? "new";
  const currencies = Array.from(new Set([f.currency, ...PROGRAM_CURRENCIES]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const res = await saveDiscount(discount?.id ?? null, {
      name: v.name, description: v.description, kind: v.kind, value: Number(v.value), currency: v.kind === "fixed_amount" ? v.currency : "",
      scope: v.scope, scopeProgramId: v.scopeProgramId, scopeServiceId: v.scopeServiceId, rule: v.rule, code: v.code,
      maxRedemptions: opt(v.maxRedemptions), maxRedemptionsPerFamily: opt(v.maxRedemptionsPerFamily),
      validFrom: fromLocal(v.validFrom, f.timeZone), validUntil: fromLocal(v.validUntil, f.timeZone),
      siblingMinPosition: v.rule === "sibling" ? opt(v.siblingMinPosition) : "", earlyBirdDaysBefore: v.rule === "early_bird" ? opt(v.earlyBirdDaysBefore) : "",
      stackable: v.stackable, isActive: v.isActive,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor={`d-name-${id}`}>{t("common.name")}</Label><Input id={`d-name-${id}`} required maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><Label htmlFor={`d-rule-${id}`}>{t("camps.discounts.rule")}</Label>
          <Select id={`d-rule-${id}`} value={v.rule} onChange={(e) => set("rule", e.target.value as DiscountRule)}>
            {DISCOUNT_RULES.map((r) => <option key={r} value={r}>{t(`camps.discounts.rules.${r}`)}</option>)}
          </Select>
        </div>
        <div><Label htmlFor={`d-kind-${id}`}>{t("camps.discounts.kind")}</Label>
          <Select id={`d-kind-${id}`} value={v.kind} onChange={(e) => set("kind", e.target.value as DiscountKind)}>
            {DISCOUNT_KINDS.map((k) => <option key={k} value={k}>{t(`camps.discounts.kinds.${k}`)}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor={`d-val-${id}`}>{t("camps.discounts.value")}</Label><Input id={`d-val-${id}`} type="number" min="0.01" step="0.01" required value={v.value} onChange={(e) => set("value", e.target.value)} /></div>
          {v.kind === "fixed_amount" && (
            <div><Label htmlFor={`d-cur-${id}`}>{t("camps.discounts.currency")}</Label>
              <Select id={`d-cur-${id}`} value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          )}
        </div>
        <div><Label htmlFor={`d-scope-${id}`}>{t("camps.discounts.scope")}</Label>
          <Select id={`d-scope-${id}`} value={v.scope} onChange={(e) => set("scope", e.target.value as DiscountScope)}>
            {DISCOUNT_SCOPES.map((s) => <option key={s} value={s}>{t(`camps.discounts.scopes.${s}`)}</option>)}
          </Select>
        </div>
        {v.scope === "program" && (
          <div><Label htmlFor={`d-prog-${id}`}>{t("camps.discounts.scopes.program")}</Label>
            <Select id={`d-prog-${id}`} value={v.scopeProgramId} onChange={(e) => set("scopeProgramId", e.target.value)}>
              <option value="">{t("common.select")}</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        )}
        {v.scope === "service" && (
          <div><Label htmlFor={`d-svc-${id}`}>{t("camps.discounts.scopes.service")}</Label>
            <Select id={`d-svc-${id}`} value={v.scopeServiceId} onChange={(e) => set("scopeServiceId", e.target.value)}>
              <option value="">{t("common.select")}</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        )}
        {v.rule === "promo_code" && (<>
          <div><Label htmlFor={`d-code-${id}`}>{t("camps.discounts.code")}</Label><Input id={`d-code-${id}`} required maxLength={40} className="font-mono uppercase" value={v.code} onChange={(e) => set("code", e.target.value.toUpperCase())} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor={`d-max-${id}`}>{t("camps.discounts.maxRedemptions")}</Label><Input id={`d-max-${id}`} type="number" min="1" value={v.maxRedemptions} onChange={(e) => set("maxRedemptions", e.target.value)} /></div>
            <div><Label htmlFor={`d-maxf-${id}`}>{t("camps.discounts.maxPerFamily")}</Label><Input id={`d-maxf-${id}`} type="number" min="1" value={v.maxRedemptionsPerFamily} onChange={(e) => set("maxRedemptionsPerFamily", e.target.value)} /></div>
          </div>
        </>)}
        {v.rule === "sibling" && (
          <div><Label htmlFor={`d-sib-${id}`}>{t("camps.discounts.siblingFrom")}</Label><Input id={`d-sib-${id}`} type="number" min="2" max="20" value={v.siblingMinPosition} onChange={(e) => set("siblingMinPosition", e.target.value)} /></div>
        )}
        {v.rule === "early_bird" && (
          <div><Label htmlFor={`d-eb-${id}`}>{t("camps.discounts.daysBefore")}</Label><Input id={`d-eb-${id}`} type="number" min="0" max="730" value={v.earlyBirdDaysBefore} onChange={(e) => set("earlyBirdDaysBefore", e.target.value)} /></div>
        )}
        <div><Label htmlFor={`d-from-${id}`}>{t("camps.discounts.validFrom")}</Label><Input id={`d-from-${id}`} type="datetime-local" value={v.validFrom} onChange={(e) => set("validFrom", e.target.value)} /></div>
        <div><Label htmlFor={`d-until-${id}`}>{t("camps.discounts.validUntil")}</Label><Input id={`d-until-${id}`} type="datetime-local" value={v.validUntil} onChange={(e) => set("validUntil", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`d-desc-${id}`}>{t("camps.discounts.description")}</Label><Textarea id={`d-desc-${id}`} maxLength={1000} value={v.description} onChange={(e) => set("description", e.target.value)} /></div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={v.stackable} onChange={(e) => set("stackable", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" />{t("camps.discounts.stackable")}</label>
        <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" />{t("camps.active")}</label>
      </div>
      <p className="text-xs text-ink-3">{t(`camps.discounts.ruleHints.${v.rule}`)}</p>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDone}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

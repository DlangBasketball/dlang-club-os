"use client";
import * as React from "react";
import { Ban, Lock, LockOpen, Play, Plus, RefreshCw, Save, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { Button, FieldHint, Input, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import {
  applySupportNow, closePeriod, deleteAccount, deleteReimbursement, pauseFamilyDunning, processRefund, rejectRefund, reopenPeriod,
  resolveDunningCase, resumeFamilyDunning, retryStripeRefund, runDunningNow, saveAccount, saveDunningSettings, saveMappings, savePolicy,
  saveReimbursement, saveSupport, seedDefaultChart, setSupportActive,
} from "@/lib/actions/accounting";
import { ACCOUNT_TYPES } from "@/lib/accounting/chart";
import { MEDICAL_MODES, RESOLUTIONS, type ProductType } from "@/lib/accounting/refunds";
import { SUPPORT_REASONS } from "@/lib/pricing/discounts";
import type { DunningSettings } from "@/lib/accounting/dunning";
import { askReason, useAct } from "./use-act";

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------
export function SeedChartButton() {
  const t = useT();
  const { busy, run, status } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => run(() => seedDefaultChart())}><Sparkles className="h-4 w-4" aria-hidden /> {t("accounting.chart.seed")}</Button>
      {status}
    </span>
  );
}

export function AddAccountForm() {
  const t = useT();
  const { busy, run, status } = useAct();
  const [v, setV] = React.useState({ number: "", name: "", type: "income" as (typeof ACCOUNT_TYPES)[number] });
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
      e.preventDefault();
      void run(() => saveAccount(null, { ...v, isActive: true }), () => setV({ number: "", name: "", type: v.type }));
    }}>
      <div><Label htmlFor="acc-n">{t("accounting.chart.number")}</Label><Input id="acc-n" value={v.number} onChange={(e) => setV({ ...v, number: e.target.value })} className="w-28" required /></div>
      <div className="min-w-48 flex-1"><Label htmlFor="acc-name">{t("accounting.chart.name")}</Label><Input id="acc-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></div>
      <div>
        <Label htmlFor="acc-type">{t("accounting.chart.type")}</Label>
        <Select id="acc-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as typeof v.type })} className="w-40">
          {ACCOUNT_TYPES.map((x) => <option key={x} value={x}>{t(`accounting.chart.types.${x}`)}</option>)}
        </Select>
      </div>
      <Button type="submit" disabled={busy}><Plus className="h-4 w-4" aria-hidden /> {t("accounting.chart.addAccount")}</Button>
      {status}
    </form>
  );
}

export function AccountRowActions({ id, number, name, type, active }: { id: string; number: string; name: string; type: (typeof ACCOUNT_TYPES)[number]; active: boolean }) {
  const t = useT();
  const { busy, run, status } = useAct();
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => saveAccount(id, { number, name, type, isActive: !active }))}>
        {active ? t("accounting.common.deactivate") : t("accounting.common.activate")}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} aria-label={t("accounting.common.delete")} onClick={() => {
        if (window.confirm(t("accounting.chart.deleteConfirm", { number }))) void run(() => deleteAccount(id));
      }}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
      {status}
    </div>
  );
}

export type MappingField = { key: string; label: string; account: string | null; vatCode: string | null; vatOnly?: boolean };

export function MappingForm({ fields, accounts }: { fields: MappingField[]; accounts: { number: string; name: string }[] }) {
  const t = useT();
  const { busy, run, status } = useAct();
  const [vals, setVals] = React.useState(() => Object.fromEntries(fields.map((f) => [f.key, { account: f.account ?? "", vatCode: f.vatCode ?? "" }])));
  const set = (k: string, patch: Partial<{ account: string; vatCode: string }>) => setVals((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      void run(() => saveMappings(fields.map((f) => ({ key: f.key, account: f.vatOnly ? null : vals[f.key].account || null, vatCode: vals[f.key].vatCode || null }))));
    }}>
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor={`map-${f.key}`}>{f.label}</Label>
              {f.vatOnly ? (
                <Input id={`map-${f.key}`} value={vals[f.key].vatCode} onChange={(e) => set(f.key, { vatCode: e.target.value })} placeholder={t("accounting.chart.vatCode")} />
              ) : (
                <Select id={`map-${f.key}`} value={vals[f.key].account} onChange={(e) => set(f.key, { account: e.target.value })}>
                  <option value="">{t("accounting.chart.unmapped")}</option>
                  {accounts.map((a) => <option key={a.number} value={a.number}>{a.number} · {a.name}</option>)}
                </Select>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}><Save className="h-4 w-4" aria-hidden /> {t("accounting.chart.saveMappings")}</Button>
        {status}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------
export function ClosePeriodForm({ defaultMonth, maxMonth }: { defaultMonth: string; maxMonth: string }) {
  const t = useT();
  const { busy, run, status } = useAct();
  const [m, setM] = React.useState(defaultMonth);
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
      e.preventDefault();
      if (window.confirm(t("accounting.periods.closeConfirm", { month: m }))) void run(() => closePeriod(m));
    }}>
      <div><Label htmlFor="close-m">{t("accounting.periods.month")}</Label><Input id="close-m" type="month" value={m} max={maxMonth} onChange={(e) => setM(e.target.value)} className="w-44" required /></div>
      <Button type="submit" disabled={busy}><Lock className="h-4 w-4" aria-hidden /> {t("accounting.periods.close")}</Button>
      {status}
    </form>
  );
}

export function ReopenPeriodButton({ month }: { month: string }) {
  const t = useT();
  const { busy, run, status } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
        const reason = askReason(t("accounting.periods.reopenReasonPrompt"));
        if (reason) void run(() => reopenPeriod(month, reason));
      }}><LockOpen className="h-3.5 w-3.5" aria-hidden /> {t("accounting.periods.reopen")}</Button>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Refund policies + processing
// ---------------------------------------------------------------------------
export type PolicyValues = {
  productType: ProductType; fullUntilDays: number | null; partialPercent: number; partialUntilDays: number | null;
  medicalMode: (typeof MEDICAL_MODES)[number]; medicalPercent: number; notes: string | null; isActive: boolean;
};

export function PolicyForm({ initial }: { initial: PolicyValues }) {
  const t = useT();
  const { busy, run, status } = useAct();
  const [v, setV] = React.useState(initial);
  const num = (s: string) => (s === "" ? null : Number(s));
  const id = (k: string) => `pol-${initial.productType}-${k}`;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(() => savePolicy(v)); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={id("full")}>{t("accounting.refunds.fullUntilDays")}</Label>
          <Input id={id("full")} type="number" min={0} max={730} value={v.fullUntilDays ?? ""} onChange={(e) => setV({ ...v, fullUntilDays: num(e.target.value) })} /></div>
        <div><Label htmlFor={id("pp")}>{t("accounting.refunds.partialPercent")}</Label>
          <Input id={id("pp")} type="number" min={0} max={100} value={v.partialPercent} onChange={(e) => setV({ ...v, partialPercent: Number(e.target.value || 0) })} /></div>
        <div><Label htmlFor={id("pu")}>{t("accounting.refunds.partialUntilDays")}</Label>
          <Input id={id("pu")} type="number" min={0} max={730} value={v.partialUntilDays ?? ""} onChange={(e) => setV({ ...v, partialUntilDays: num(e.target.value) })} /></div>
        <div><Label htmlFor={id("mm")}>{t("accounting.refunds.medicalMode")}</Label>
          <Select id={id("mm")} value={v.medicalMode} onChange={(e) => setV({ ...v, medicalMode: e.target.value as PolicyValues["medicalMode"] })}>
            {MEDICAL_MODES.map((m) => <option key={m} value={m}>{t(`accounting.refunds.medicalModes.${m}`)}</option>)}
          </Select></div>
        <div><Label htmlFor={id("mp")}>{t("accounting.refunds.medicalPercent")}</Label>
          <Input id={id("mp")} type="number" min={0} max={100} value={v.medicalPercent} onChange={(e) => setV({ ...v, medicalPercent: Number(e.target.value || 0) })} /></div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2">
          <input type="checkbox" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" />
          {t("accounting.common.active")}
        </label>
      </div>
      <div><Label htmlFor={id("notes")}>{t("accounting.refunds.notes")}</Label>
        <Textarea id={id("notes")} rows={2} maxLength={2000} value={v.notes ?? ""} onChange={(e) => setV({ ...v, notes: e.target.value || null })} />
        <FieldHint>{t("accounting.refunds.notesHint")}</FieldHint></div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}><Save className="h-4 w-4" aria-hidden /> {t("accounting.common.save")}</Button>
        {status}
      </div>
    </form>
  );
}

export function RefundProcessForm({ requestId, computed, currency, preference, status: reqStatus }: {
  requestId: string; computed: number; currency: string; preference: string | null; status: string;
}) {
  const t = useT();
  const { busy, run, status } = useAct();
  const [resolution, setResolution] = React.useState<(typeof RESOLUTIONS)[number]>((RESOLUTIONS as readonly string[]).includes(preference ?? "") ? (preference as (typeof RESOLUTIONS)[number]) : "family_credit");
  const [amount, setAmount] = React.useState(String(computed));
  const [override, setOverride] = React.useState("");
  const changed = Number(amount) !== computed;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor={`res-${requestId}`}>{t("accounting.refunds.resolution")}</Label>
          <Select id={`res-${requestId}`} value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)} className="w-44">
            {RESOLUTIONS.map((r) => <option key={r} value={r}>{t(`accounting.refunds.resolutions.${r}`)}</option>)}
          </Select></div>
        {reqStatus === "requested" && (
          <div><Label htmlFor={`amt-${requestId}`}>{t("accounting.refunds.amountLabel", { currency })}</Label>
            <Input id={`amt-${requestId}`} type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" /></div>
        )}
        {(changed || reqStatus !== "requested") && (
          <div className="min-w-48 flex-1"><Label htmlFor={`ovr-${requestId}`}>{t("accounting.refunds.overrideReason")}</Label>
            <Input id={`ovr-${requestId}`} value={override} maxLength={500} onChange={(e) => setOverride(e.target.value)} /></div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => run(() => processRefund({
          requestId, resolution, amount: reqStatus === "requested" ? Number(amount) : null, overrideReason: override || null,
        }))}><Play className="h-3.5 w-3.5" aria-hidden /> {t("accounting.refunds.process")}</Button>
        {reqStatus === "stripe_failed" && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => retryStripeRefund(requestId))}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t("accounting.refunds.retryStripe")}</Button>
        )}
        {reqStatus === "requested" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
            const reason = askReason(t("accounting.refunds.rejectPrompt"));
            if (reason) void run(() => rejectRefund(requestId, reason));
          }}><Ban className="h-3.5 w-3.5" aria-hidden /> {t("accounting.refunds.reject")}</Button>
        )}
        {status}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dunning
// ---------------------------------------------------------------------------
export function DunningSettingsForm({ initial, currency }: { initial: DunningSettings; currency: string }) {
  const t = useT();
  const { busy, run, status } = useAct();
  const [v, setV] = React.useState(initial);
  const field = (k: keyof DunningSettings, label: string, step?: string) => (
    <div><Label htmlFor={`dun-${k}`}>{label}</Label>
      <Input id={`dun-${k}`} type="number" min={0} step={step ?? "1"} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value || 0) })} /></div>
  );
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(() => saveDunningSettings(v)); }}>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" />
        {t("accounting.dunning.enabled")}
      </label>
      <div className="grid gap-3 sm:grid-cols-4">
        {field("level1Days", t("accounting.dunning.level1Days"))}
        {field("level2Days", t("accounting.dunning.level2Days"))}
        {field("level3Days", t("accounting.dunning.level3Days"))}
        {field("collectionDays", t("accounting.dunning.collectionDays"))}
        {field("level2Fee", t("accounting.dunning.level2Fee", { currency }), "0.01")}
        {field("level3Fee", t("accounting.dunning.level3Fee", { currency }), "0.01")}
        {field("minBalance", t("accounting.dunning.minBalance", { currency }), "0.01")}
      </div>
      <FieldHint>{t("accounting.dunning.daysHint")}</FieldHint>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}><Save className="h-4 w-4" aria-hidden /> {t("accounting.common.save")}</Button>
        {status}
      </div>
    </form>
  );
}

export function RunDunningButton() {
  const t = useT();
  const { busy, run, status } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button disabled={busy} onClick={() => run(() => runDunningNow())}><Play className="h-4 w-4" aria-hidden /> {t("accounting.dunning.runNow")}</Button>
      {status}
    </span>
  );
}

export function PauseFamilyForm({ families }: { families: { id: string; name: string }[] }) {
  const t = useT();
  const { busy, run, status } = useAct();
  const [v, setV] = React.useState({ familyId: "", until: "", reason: "" });
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
      e.preventDefault();
      void run(() => pauseFamilyDunning({ familyId: v.familyId, until: v.until || null, reason: v.reason }), () => setV({ familyId: "", until: "", reason: "" }));
    }}>
      <div><Label htmlFor="pause-f">{t("accounting.common.family")}</Label>
        <Select id="pause-f" value={v.familyId} onChange={(e) => setV({ ...v, familyId: e.target.value })} className="w-56" required>
          <option value="">{t("accounting.common.choose")}</option>
          {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select></div>
      <div><Label htmlFor="pause-u">{t("accounting.dunning.pauseUntil")}</Label><Input id="pause-u" type="date" value={v.until} onChange={(e) => setV({ ...v, until: e.target.value })} className="w-44" /></div>
      <div className="min-w-48 flex-1"><Label htmlFor="pause-r">{t("accounting.common.reason")}</Label><Input id="pause-r" value={v.reason} maxLength={500} onChange={(e) => setV({ ...v, reason: e.target.value })} required /></div>
      <Button type="submit" variant="secondary" disabled={busy}>{t("accounting.dunning.pause")}</Button>
      {status}
    </form>
  );
}

export function ResumeFamilyButton({ id }: { id: string }) {
  const t = useT();
  const { busy, run, status } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => resumeFamilyDunning(id))}><X className="h-3.5 w-3.5" aria-hidden /> {t("accounting.dunning.resume")}</Button>
      {status}
    </span>
  );
}

export function ResolveCaseButton({ id }: { id: string }) {
  const t = useT();
  const { busy, run, status } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
        const reason = askReason(t("accounting.dunning.resolvePrompt"));
        if (reason) void run(() => resolveDunningCase(id, reason));
      }}><Undo2 className="h-3.5 w-3.5" aria-hidden /> {t("accounting.dunning.resolve")}</Button>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Family support + reimbursements
// ---------------------------------------------------------------------------
export function SupportForm({ families, currency }: { families: { id: string; name: string }[]; currency: string }) {
  const t = useT();
  const { busy, run, status } = useAct();
  const blank = { familyId: "", name: "", reason: "scholarship" as (typeof SUPPORT_REASONS)[number], kind: "percent" as "percent" | "fixed_amount",
    value: "", maxAmount: "", scope: "all" as "all" | "camps" | "training" | "shop", validFrom: "", validUntil: "" };
  const [v, setV] = React.useState(blank);
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      void run(() => saveSupport(null, {
        familyId: v.familyId, name: v.name, reason: v.reason, kind: v.kind, value: Number(v.value), currency: v.kind === "fixed_amount" ? currency : null,
        maxAmount: v.maxAmount ? Number(v.maxAmount) : null, scope: v.scope, validFrom: v.validFrom || null, validUntil: v.validUntil || null,
      }), () => setV(blank));
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="sup-f">{t("accounting.common.family")}</Label>
          <Select id="sup-f" value={v.familyId} onChange={(e) => setV({ ...v, familyId: e.target.value })} required>
            <option value="">{t("accounting.common.choose")}</option>
            {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select></div>
        <div><Label htmlFor="sup-n">{t("accounting.support.name")}</Label><Input id="sup-n" value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} required /></div>
        <div><Label htmlFor="sup-r">{t("accounting.support.reason")}</Label>
          <Select id="sup-r" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value as typeof v.reason })}>
            {SUPPORT_REASONS.map((r) => <option key={r} value={r}>{t(`accounting.support.reasons.${r}`)}</option>)}
          </Select></div>
        <div><Label htmlFor="sup-k">{t("accounting.support.kind")}</Label>
          <Select id="sup-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}>
            <option value="percent">{t("accounting.support.kinds.percent")}</option>
            <option value="fixed_amount">{t("accounting.support.kinds.fixed_amount", { currency })}</option>
          </Select></div>
        <div><Label htmlFor="sup-v">{t("accounting.support.value")}</Label><Input id="sup-v" type="number" min={0} step="0.01" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} required /></div>
        <div><Label htmlFor="sup-c">{t("accounting.support.cap", { currency })}</Label><Input id="sup-c" type="number" min={0} step="0.01" value={v.maxAmount} onChange={(e) => setV({ ...v, maxAmount: e.target.value })} /></div>
        <div><Label htmlFor="sup-s">{t("accounting.support.scope")}</Label>
          <Select id="sup-s" value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value as typeof v.scope })}>
            {(["all", "camps", "training", "shop"] as const).map((s) => <option key={s} value={s}>{t(`accounting.support.scopes.${s}`)}</option>)}
          </Select></div>
        <div><Label htmlFor="sup-vf">{t("accounting.support.validFrom")}</Label><Input id="sup-vf" type="date" value={v.validFrom} onChange={(e) => setV({ ...v, validFrom: e.target.value })} /></div>
        <div><Label htmlFor="sup-vu">{t("accounting.support.validUntil")}</Label><Input id="sup-vu" type="date" value={v.validUntil} onChange={(e) => setV({ ...v, validUntil: e.target.value })} /></div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}><Plus className="h-4 w-4" aria-hidden /> {t("accounting.support.add")}</Button>
        {status}
      </div>
    </form>
  );
}

export function SupportToggle({ id, active }: { id: string; active: boolean }) {
  const t = useT();
  const { busy, run, status } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setSupportActive(id, !active))}>
        {active ? t("accounting.common.deactivate") : t("accounting.common.activate")}
      </Button>
      {status}
    </span>
  );
}

export function ApplySupportButton() {
  const t = useT();
  const { busy, run, status } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => applySupportNow())}><Play className="h-3.5 w-3.5" aria-hidden /> {t("accounting.support.applyNow")}</Button>
      {status}
    </span>
  );
}

type ReimbValues = {
  funderKind: "city" | "canton" | "foundation" | "js" | "other"; funderName: string; familyId: string; invoiceId: string; periodStart: string; periodEnd: string;
  amountExpected: string; amountReceived: string; status: "expected" | "requested" | "received" | "rejected"; requestedOn: string; receivedOn: string;
  reference: string; notes: string;
};

export function ReimbursementForm({ families, invoices, currency, id, initial }: {
  families: { id: string; name: string }[]; invoices: { id: string; label: string }[]; currency: string; id?: string; initial?: Partial<ReimbValues>;
}) {
  const t = useT();
  const { busy, run, status } = useAct();
  const blank: ReimbValues = { funderKind: "city", funderName: "", familyId: "", invoiceId: "", periodStart: "", periodEnd: "", amountExpected: "",
    amountReceived: "", status: "expected", requestedOn: "", receivedOn: "", reference: "", notes: "", ...initial };
  const [v, setV] = React.useState<ReimbValues>(blank);
  const fid = (k: string) => `reimb-${id ?? "new"}-${k}`;
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      void run(() => saveReimbursement(id ?? null, {
        funderKind: v.funderKind, funderName: v.funderName, familyId: v.familyId || null, invoiceId: v.invoiceId || null,
        periodStart: v.periodStart || null, periodEnd: v.periodEnd || null, amountExpected: Number(v.amountExpected),
        amountReceived: v.amountReceived === "" ? null : Number(v.amountReceived), currency, status: v.status,
        requestedOn: v.requestedOn || null, receivedOn: v.receivedOn || null, reference: v.reference || null, notes: v.notes || null,
      }), () => { if (!id) setV(blank); });
    }}>
      <div className="grid gap-3 sm:grid-cols-4">
        <div><Label htmlFor={fid("k")}>{t("accounting.support.funderKind")}</Label>
          <Select id={fid("k")} value={v.funderKind} onChange={(e) => setV({ ...v, funderKind: e.target.value as ReimbValues["funderKind"] })}>
            {(["city", "canton", "foundation", "js", "other"] as const).map((k) => <option key={k} value={k}>{t(`accounting.support.funders.${k}`)}</option>)}
          </Select></div>
        <div className="sm:col-span-2"><Label htmlFor={fid("n")}>{t("accounting.support.funderName")}</Label><Input id={fid("n")} value={v.funderName} maxLength={140} onChange={(e) => setV({ ...v, funderName: e.target.value })} required /></div>
        <div><Label htmlFor={fid("s")}>{t("accounting.common.status")}</Label>
          <Select id={fid("s")} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as ReimbValues["status"] })}>
            {(["expected", "requested", "received", "rejected"] as const).map((k) => <option key={k} value={k}>{t(`accounting.support.statuses.${k}`)}</option>)}
          </Select></div>
        <div><Label htmlFor={fid("f")}>{t("accounting.common.family")}</Label>
          <Select id={fid("f")} value={v.familyId} onChange={(e) => setV({ ...v, familyId: e.target.value })}>
            <option value="">{t("accounting.common.none")}</option>
            {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select></div>
        <div><Label htmlFor={fid("i")}>{t("accounting.common.invoice")}</Label>
          <Select id={fid("i")} value={v.invoiceId} onChange={(e) => setV({ ...v, invoiceId: e.target.value })}>
            <option value="">{t("accounting.common.none")}</option>
            {invoices.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select></div>
        <div><Label htmlFor={fid("ps")}>{t("accounting.support.periodStart")}</Label><Input id={fid("ps")} type="date" value={v.periodStart} onChange={(e) => setV({ ...v, periodStart: e.target.value })} /></div>
        <div><Label htmlFor={fid("pe")}>{t("accounting.support.periodEnd")}</Label><Input id={fid("pe")} type="date" value={v.periodEnd} onChange={(e) => setV({ ...v, periodEnd: e.target.value })} /></div>
        <div><Label htmlFor={fid("ae")}>{t("accounting.support.expected")} ({currency})</Label><Input id={fid("ae")} type="number" min={0} step="0.01" value={v.amountExpected} onChange={(e) => setV({ ...v, amountExpected: e.target.value })} required /></div>
        <div><Label htmlFor={fid("ar")}>{t("accounting.support.received")} ({currency})</Label><Input id={fid("ar")} type="number" min={0} step="0.01" value={v.amountReceived} onChange={(e) => setV({ ...v, amountReceived: e.target.value })} /></div>
        <div><Label htmlFor={fid("rq")}>{t("accounting.support.requestedOn")}</Label><Input id={fid("rq")} type="date" value={v.requestedOn} onChange={(e) => setV({ ...v, requestedOn: e.target.value })} /></div>
        <div><Label htmlFor={fid("rc")}>{t("accounting.support.receivedOn")}</Label><Input id={fid("rc")} type="date" value={v.receivedOn} onChange={(e) => setV({ ...v, receivedOn: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label htmlFor={fid("ref")}>{t("accounting.support.reference")}</Label><Input id={fid("ref")} value={v.reference} maxLength={140} onChange={(e) => setV({ ...v, reference: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label htmlFor={fid("no")}>{t("accounting.common.notes")}</Label><Input id={fid("no")} value={v.notes} maxLength={1000} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}><Save className="h-4 w-4" aria-hidden /> {id ? t("accounting.common.save") : t("accounting.support.addReimbursement")}</Button>
        {id && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={t("accounting.common.delete")} onClick={() => {
            if (window.confirm(t("accounting.support.deleteConfirm"))) void run(() => deleteReimbursement(id));
          }}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
        )}
        {status}
      </div>
    </form>
  );
}

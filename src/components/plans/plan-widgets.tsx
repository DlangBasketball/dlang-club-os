"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CreditCard, FileDown, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import {
  addPause, adminCreatePlan, cancelPlan, choosePlan, endEnrolment, payInstalment, payPlanBalance, removePause, reschedulePlan,
  retryCharge, setPlanPaused, skipPeriod,
} from "@/lib/actions/plans";
import type { PlanOption } from "@/lib/payments/plans";

type Res = { ok: true; message?: string } | { ok: false; error: string };

/** Runs a server action, shows its translated message, refreshes the page. */
export function usePlanAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function run(fn: () => Promise<Res>, after?: () => void) {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return false; }
    if (r.message) setMsg({ ok: true, text: r.message });
    after?.();
    router.refresh();
    return true;
  }
  const note = msg ? <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p> : null;
  return { busy, run, note };
}

// ---------------------------------------------------------------------------
// Parent / payer
// ---------------------------------------------------------------------------
/** "Pay in instalments" on an open invoice (club rules preview). */
export function ChoosePlanForm({ invoiceId, options, currency }: { invoiceId: string; options: PlanOption[]; currency: string }) {
  const t = useT();
  const f = useFormat();
  const { busy, run, note } = usePlanAction();
  const [count, setCount] = React.useState(options[0]?.count ?? 0);
  const chosen = options.find((o) => o.count === count);
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={t("plans.choose.title")} className="space-y-1">
        {options.map((o) => (
          <label key={o.count} className="flex cursor-pointer items-center gap-2 text-sm text-ink-2" htmlFor={`cp-${o.count}`}>
            <input id={`cp-${o.count}`} type="radio" name="cp-count" checked={count === o.count} onChange={() => setCount(o.count)} />
            {t("plans.choose.option", { count: o.count, amount: f.money(o.amounts[0], currency) })}
            {o.fee > 0 && <span className="text-xs text-ink-3">{t("plans.choose.fee", { amount: f.money(o.fee, currency) })}</span>}
          </label>
        ))}
      </div>
      {chosen && (
        <ol className="space-y-1 rounded-md bg-surface-elevated/50 p-3 text-xs text-ink-2" aria-label={t("plans.choose.schedule")}>
          {chosen.dates.map((d, i) => (
            <li key={d + i} className="flex justify-between gap-3">
              <span>{t("plans.common.seqOf", { seq: i + 1, count: chosen.count })} · {f.date(d)}</span>
              <span className="tnum">{f.money(chosen.amounts[i], currency)}</span>
            </li>
          ))}
        </ol>
      )}
      <Button disabled={busy || !chosen} onClick={() => run(() => choosePlan(invoiceId, count))}>
        {busy ? t("common.saving") : t("plans.choose.confirm", { count })}
      </Button>
      {note}
    </div>
  );
}

/** Card / TWINT payment of one instalment (Stripe Checkout). */
export function PayInstalmentButton({ installmentId, label }: { installmentId: string; label: string }) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <Button size="sm" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await payInstalment(installmentId);
        if (r.ok) window.location.href = r.url; else { setErr(r.error); setBusy(false); }
      }}><CreditCard className="h-3.5 w-3.5" /> {busy ? t("payments.redirecting") : label}</Button>
      {err && <span role="alert" className="mt-1 text-xs text-danger">{err}</span>}
    </span>
  );
}

/** Pay the whole remaining balance of an instalment plan at once. */
export function PayPlanBalanceButton({ planId, label }: { planId: string; label: string }) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await payPlanBalance(planId);
        if (r.ok) window.location.href = r.url; else { setErr(r.error); setBusy(false); }
      }}><CreditCard className="h-3.5 w-3.5" /> {busy ? t("payments.redirecting") : label}</Button>
      {err && <span role="alert" className="mt-1 text-xs text-danger">{err}</span>}
    </span>
  );
}

export function QrBillLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-maroon hover:underline">
      <FileDown className="h-3.5 w-3.5" /> {label}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Admin / finance
// ---------------------------------------------------------------------------
/** Create a plan on an open invoice: by the club's rules or a custom schedule. */
export function AdminCreatePlan({ invoiceId, balance, currency, options, today }: {
  invoiceId: string; balance: number; currency: string; options: PlanOption[]; today: string;
}) {
  const t = useT();
  const f = useFormat();
  const { busy, run, note } = usePlanAction();
  const [mode, setMode] = React.useState<"rules" | "custom">(options.length ? "rules" : "custom");
  const [count, setCount] = React.useState(options[0]?.count ?? 0);
  const [fee, setFee] = React.useState("0");
  const [rows, setRows] = React.useState<{ date: string; amount: string }[]>(() => {
    const half = Math.round((balance / 2) * 100) / 100;
    return [{ date: today, amount: String(half) }, { date: today, amount: String(Math.round((balance - half) * 100) / 100) }];
  });
  const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const target = balance + (Number(fee) || 0);
  const matches = Math.abs(sum - target) < 0.0005;
  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="group" aria-label={t("plans.admin.createTitle")}>
        {options.length > 0 && <Button size="sm" variant={mode === "rules" ? "primary" : "secondary"} onClick={() => setMode("rules")}>{t("plans.admin.byRules")}</Button>}
        <Button size="sm" variant={mode === "custom" ? "primary" : "secondary"} onClick={() => setMode("custom")}>{t("plans.admin.custom")}</Button>
      </div>
      {mode === "rules" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="acp-count">{t("plans.admin.count")}</Label>
            <Select id="acp-count" value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
              {options.map((o) => <option key={o.count} value={o.count}>{t("plans.choose.option", { count: o.count, amount: f.money(o.amounts[0], currency) })}</option>)}
            </Select></div>
          <Button size="sm" disabled={busy || !count} onClick={() => run(() => choosePlan(invoiceId, count))}>{t("plans.admin.create")}</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div><Label htmlFor={`acp-d-${i}`}>{t("plans.common.seqOf", { seq: i + 1, count: rows.length })}</Label>
                <Input id={`acp-d-${i}`} type="date" value={r.date} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)))} /></div>
              <div><Label htmlFor={`acp-a-${i}`}>{t("plans.common.amount")}</Label>
                <Input id={`acp-a-${i}`} inputMode="decimal" className="w-32 tnum" value={r.amount} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} /></div>
              {rows.length > 2 && <Button size="sm" variant="ghost" aria-label={t("plans.admin.removeRow")} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" variant="secondary" disabled={rows.length >= 24} onClick={() => setRows((x) => [...x, { date: x[x.length - 1]?.date ?? today, amount: "0" }])}><Plus className="h-4 w-4" /> {t("plans.admin.addRow")}</Button>
            <div><Label htmlFor="acp-fee">{t("plans.admin.fee")}</Label><Input id="acp-fee" inputMode="decimal" className="w-28 tnum" value={fee} onChange={(e) => setFee(e.target.value)} /></div>
          </div>
          <p className={`text-xs ${matches ? "text-ink-3" : "text-danger"}`}>{t("plans.admin.sumCheck", { sum: f.money(sum, currency), target: f.money(target, currency) })}</p>
          <Button size="sm" disabled={busy || !matches} onClick={() => run(() => adminCreatePlan(invoiceId, {
            dates: rows.map((r) => r.date), amounts: rows.map((r) => Number(r.amount) || 0), fee: Number(fee) || 0,
          }))}>{t("plans.admin.create")}</Button>
        </div>
      )}
      {note}
    </div>
  );
}

/** Edit dates / amounts of unpaid instalments (total must stay the same). */
export function ScheduleEditor({ planId, currency, total, rows }: {
  planId: string; currency: string; total: number;
  rows: { id: string; seq: number; dueDate: string; amount: number; amountPaid: number; locked: boolean }[];
}) {
  const t = useT();
  const f = useFormat();
  const { busy, run, note } = usePlanAction();
  const [edit, setEdit] = React.useState(rows.map((r) => ({ ...r, amountStr: String(r.amount) })));
  const [why, setWhy] = React.useState("");
  const sum = edit.reduce((s, r) => s + (Number(r.amountStr) || 0), 0);
  const ok = Math.abs(sum - total) < 0.0005;
  return (
    <div className="space-y-2">
      {edit.map((r, i) => (
        <div key={r.id} className="flex flex-wrap items-end gap-2">
          <span className="w-16 text-sm text-ink-3">{t("plans.common.seqShort", { seq: r.seq })}</span>
          <div><Label htmlFor={`se-d-${r.id}`} className="sr-only">{t("plans.common.dueDate")}</Label>
            <Input id={`se-d-${r.id}`} type="date" disabled={r.locked} value={r.dueDate} onChange={(e) => setEdit((x) => x.map((y, j) => (j === i ? { ...y, dueDate: e.target.value } : y)))} /></div>
          <div><Label htmlFor={`se-a-${r.id}`} className="sr-only">{t("plans.common.amount")}</Label>
            <Input id={`se-a-${r.id}`} inputMode="decimal" disabled={r.locked} className="w-32 tnum" value={r.amountStr} onChange={(e) => setEdit((x) => x.map((y, j) => (j === i ? { ...y, amountStr: e.target.value } : y)))} /></div>
          {r.amountPaid > 0 && <span className="text-xs text-ink-3">{t("plans.common.paidSoFar", { amount: f.money(r.amountPaid, currency) })}</span>}
        </div>
      ))}
      <p className={`text-xs ${ok ? "text-ink-3" : "text-danger"}`}>{t("plans.admin.sumCheck", { sum: f.money(sum, currency), target: f.money(total, currency) })}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1"><Label htmlFor="se-why">{t("plans.admin.reasonOptional")}</Label><Input id="se-why" maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} /></div>
        <Button size="sm" disabled={busy || !ok} onClick={() => run(() => reschedulePlan(planId, {
          items: edit.filter((r) => !r.locked).map((r) => ({ id: r.id, due_date: r.dueDate, amount: Number(r.amountStr) || 0 })), reason: why,
        }))}>{t("plans.admin.saveSchedule")}</Button>
      </div>
      {note}
    </div>
  );
}

export function PlanControls({ planId, status, kind }: { planId: string; status: string; kind: "installments" | "recurring" }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  const [end, setEnd] = React.useState("");
  if (status !== "active" && status !== "paused") return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "active"
          ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => { const r = window.prompt(t("plans.admin.pausePrompt")); if (r !== null) run(() => setPlanPaused(planId, true, r)); }}><Pause className="h-4 w-4" /> {t("plans.admin.pause")}</Button>
          : <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => setPlanPaused(planId, false))}><Play className="h-4 w-4" /> {t("plans.admin.resume")}</Button>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const r = window.prompt(t(kind === "recurring" ? "plans.admin.cancelEnrolmentPrompt" : "plans.admin.cancelPrompt")); if (r && r.trim()) run(() => cancelPlan(planId, r)); }}>
          <X className="h-4 w-4" /> {t(kind === "recurring" ? "plans.admin.cancelEnrolment" : "plans.admin.cancel")}
        </Button>
      </div>
      {kind === "recurring" && (
        <div className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="pc-end">{t("plans.recurring.endOn")}</Label><Input id="pc-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          <Button size="sm" variant="secondary" disabled={busy || !end} onClick={() => run(() => endEnrolment(planId, end))}>{t("plans.recurring.endEnrolment")}</Button>
        </div>
      )}
      {note}
    </div>
  );
}

export function PauseForm({ planId }: { planId: string }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [kind, setKind] = React.useState<"holiday" | "injury" | "other">("holiday");
  const [txt, setTxt] = React.useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor="pf-from">{t("plans.recurring.from")}</Label><Input id="pf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="pf-to">{t("plans.recurring.to")}</Label><Input id="pf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><Label htmlFor="pf-kind">{t("plans.recurring.pauseKind")}</Label>
          <Select id="pf-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="holiday">{t("plans.recurring.pauseKinds.holiday")}</option>
            <option value="injury">{t("plans.recurring.pauseKinds.injury")}</option>
            <option value="other">{t("plans.recurring.pauseKinds.other")}</option>
          </Select></div>
        <div className="min-w-[160px] flex-1"><Label htmlFor="pf-note">{t("plans.recurring.pauseNote")}</Label><Input id="pf-note" maxLength={300} value={txt} onChange={(e) => setTxt(e.target.value)} /></div>
        <Button size="sm" disabled={busy || !from || !to} onClick={() => run(() => addPause(planId, from, to, kind, txt), () => { setFrom(""); setTo(""); setTxt(""); })}>{t("plans.recurring.addPause")}</Button>
      </div>
      <p className="text-xs text-ink-3">{t("plans.recurring.pauseHint")}</p>
      {note}
    </div>
  );
}

export function RemovePauseButton({ pauseId, planId }: { pauseId: string; planId: string }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  return <span>{<Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => removePause(pauseId, planId))}>{t("plans.recurring.removePause")}</Button>}{note}</span>;
}

export function SkipPeriodButton({ planId, periodStart }: { planId: string; periodStart: string }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const r = window.prompt(t("plans.recurring.skipPrompt")); if (r && r.trim()) run(() => skipPeriod(planId, periodStart, r)); }}>{t("plans.recurring.skip")}</Button>
      {note}
    </span>
  );
}

export function SkipFutureForm({ planId }: { planId: string }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  const [d, setD] = React.useState("");
  const [why, setWhy] = React.useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor="sf-d">{t("plans.recurring.periodStart")}</Label><Input id="sf-d" type="date" value={d} onChange={(e) => setD(e.target.value)} /></div>
        <div className="min-w-[200px] flex-1"><Label htmlFor="sf-why">{t("plans.common.reason")}</Label><Input id="sf-why" maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} /></div>
        <Button size="sm" variant="secondary" disabled={busy || !d || !why.trim()} onClick={() => run(() => skipPeriod(planId, d, why), () => { setD(""); setWhy(""); })}>{t("plans.recurring.skip")}</Button>
      </div>
      {note}
    </div>
  );
}

export function RetryChargeButton({ installmentId }: { installmentId: string }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => retryCharge(installmentId))}>{busy ? t("common.saving") : t("plans.autopay.retryNow")}</Button>
      {note}
    </span>
  );
}

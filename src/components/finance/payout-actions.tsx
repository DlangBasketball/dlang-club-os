"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Undo2 } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { markPayoutPaid, saveCoachRate, voidPayout, type FinanceResult } from "@/lib/actions/finance";
import { EXPENSE_METHODS, RATE_TYPES } from "@/lib/finance/validation";
import { useFormat, useT } from "@/lib/i18n/client";

function useAct() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function run(fn: () => Promise<FinanceResult>, after?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.error });
    if (res.ok) { after?.(); router.refresh(); }
  }
  const note = msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>;
  return { busy, run, note };
}

/** Inline editor for a coach's pay rate. */
export function RateEditor({ coachId, coachName, rate }: { coachId: string; coachName: string; rate: { rateType: string; amount: number; currency: string } | null }) {
  const t = useT();
  const f = useFormat();
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState(rate?.rateType ?? "per_session");
  const [amount, setAmount] = React.useState(rate ? String(rate.amount) : "");
  const { busy, run, note } = useAct();
  const id = `rate-${coachId}`;
  if (!open) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="tnum text-ink">{rate ? `${f.money(rate.amount, rate.currency)} ${t(`finance.payouts.per.${rate.rateType as "hourly" | "per_session"}`)}` : t("finance.payouts.noRate")}</span>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={t("finance.payouts.editRateFor", { coach: coachName })}><Pencil className="h-3.5 w-3.5" aria-hidden /></Button>
        {note}
      </span>
    );
  }
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => saveCoachRate({ coachId, rateType: type, amount, currency: rate?.currency }), () => setOpen(false)); }}>
      <div>
        <Label htmlFor={`${id}-type`} className="sr-only">{t("finance.payouts.rateType")}</Label>
        <Select id={`${id}-type`} value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-36 text-xs">
          {RATE_TYPES.map((r) => <option key={r} value={r}>{t(`finance.payouts.rateTypes.${r}`)}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${id}-amount`} className="sr-only">{t("finance.payouts.rate")}</Label>
        <Input id={`${id}-amount`} type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 w-24 text-xs" />
      </div>
      <Button type="submit" size="sm" disabled={busy}>{t("common.save")}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
      {note}
    </form>
  );
}

/** Mark the month as paid (creates the expense) or undo it. */
export function PayoutButtons({ coachId, coachName, month, amountLabel, payoutId, canPay, today }: {
  coachId: string; coachName: string; month: string; amountLabel: string; payoutId: string | null; canPay: boolean; today: string;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [paidOn, setPaidOn] = React.useState(today);
  const [method, setMethod] = React.useState("bank_transfer");
  const { busy, run, note } = useAct();
  if (payoutId) {
    return (
      <span className="inline-flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
          const reason = window.prompt(t("finance.payouts.voidPrompt", { coach: coachName }));
          if (reason && reason.trim()) void run(() => voidPayout(payoutId, reason));
        }}><Undo2 className="h-3.5 w-3.5" aria-hidden /> {t("finance.payouts.void")}</Button>
        {note}
      </span>
    );
  }
  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <Button size="sm" disabled={!canPay || busy} onClick={() => setOpen(true)}><Check className="h-3.5 w-3.5" aria-hidden /> {t("finance.payouts.markPaid")}</Button>
        {note}
      </span>
    );
  }
  const id = `pay-${coachId}`;
  return (
    <form className="flex flex-wrap items-end justify-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      if (window.confirm(t("finance.payouts.confirmPay", { coach: coachName, amount: amountLabel }))) void run(() => markPayoutPaid(coachId, month, paidOn, method), () => setOpen(false));
    }}>
      <div><Label htmlFor={`${id}-on`} className="sr-only">{t("finance.expenses.paidOn")}</Label><Input id={`${id}-on`} type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="h-8 w-36 text-xs" /></div>
      <div>
        <Label htmlFor={`${id}-m`} className="sr-only">{t("finance.common.method")}</Label>
        <Select id={`${id}-m`} value={method} onChange={(e) => setMethod(e.target.value)} className="h-8 w-36 text-xs">
          {EXPENSE_METHODS.map((m) => <option key={m} value={m}>{t(`finance.methods.${m}`)}</option>)}
        </Select>
      </div>
      <Button type="submit" size="sm" disabled={busy}>{t("finance.payouts.confirm")}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
      {note}
    </form>
  );
}

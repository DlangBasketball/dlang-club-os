"use client";

import * as React from "react";
import { Banknote, LogOut, RotateCcw } from "lucide-react";
import { Badge, Input, Label, Select, Textarea } from "@/components/ui";
import { ActionDialog } from "@/components/money/action-dialog";
import { useFormat, useT } from "@/lib/i18n/client";
import type { PaymentStatus } from "@/lib/selection/arrangement";
import type { EnrollmentInstallment, EnrollmentPayment } from "@/lib/selection/roster";
import { enrollRosterNow, recordRosterPayment, voidRosterPayment, withdrawRosterEnrollment, withdrawRosterTournament } from "@/lib/actions/selection-roster";

const METHODS = ["bank_transfer", "twint", "qr_bill", "card", "manual"] as const;
const PAY_TONE: Record<PaymentStatus, "success" | "warning" | "danger" | "neutral"> = { paid: "success", partial: "warning", unpaid: "danger", none: "neutral" };

/**
 * Agreement summary + payments received (separate records): agreed fee,
 * received, outstanding, next due date, status, overdue flag; record a
 * payment (existing offline payment RPC) and reverse one (existing void
 * workflow, reason required). Finance and admin only.
 */
export function EnrollmentMoney({
  applicationId, currency, agreedFee, amountDue, received, balance, nextDueOn, overdueAmount, status, payments, installments, today, canRecord, invoiceHref,
}: {
  applicationId: string; currency: string; agreedFee: number | null; amountDue: number | null; received: number | null; balance: number | null;
  nextDueOn: string | null; overdueAmount: number | null; status: PaymentStatus | null; payments: EnrollmentPayment[];
  installments: EnrollmentInstallment[]; today: string; canRecord: boolean; invoiceHref: string | null;
}) {
  const t = useT();
  const f = useFormat();
  const fmt = (n: number | null | undefined) => (n == null ? "—" : f.money(n, currency));
  const [amount, setAmount] = React.useState("");
  const [paidOn, setPaidOn] = React.useState(today);
  const [method, setMethod] = React.useState<(typeof METHODS)[number]>("bank_transfer");
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const id = React.useId();

  let cum = 0;
  const paidSoFar = Math.max(received ?? 0, 0);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        {([
          ["agreedFee", fmt(agreedFee)], ["amountDue", fmt(amountDue)], ["received", fmt(received)], ["balance", fmt(balance)],
          ["nextDue", nextDueOn ? f.date(nextDueOn) : "—"],
        ] as const).map(([k, v]) => (
          <div key={k}><dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t(`roster.money.${k}`)}</dt><dd className="font-display text-lg tnum text-text">{v}</dd></div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {status && <Badge tone={PAY_TONE[status]}>{t(`roster.paymentStatus.${status}`)}</Badge>}
        {(overdueAmount ?? 0) > 0 && <Badge tone="danger" dot>{t("roster.money.overdueAmount", { amount: fmt(overdueAmount) })}</Badge>}
        {invoiceHref && <a href={invoiceHref} className="text-xs text-brand-primary hover:underline">{t("roster.money.openInvoice")}</a>}
        {canRecord && (
          <span className="ml-auto">
            <ActionDialog
              trigger={<><Banknote className="h-4 w-4" /> {t("roster.payments.record")}</>}
              triggerVariant="primary"
              title={t("roster.payments.recordTitle")}
              description={t("roster.payments.recordHint", { balance: fmt(balance) })}
              confirmLabel={t("roster.payments.record")}
              askReason={false}
              onConfirm={async () => {
                const res = await recordRosterPayment(applicationId, { amount: Number(amount.replace(",", ".")), paidOn, method, reference, note });
                if (res.ok) { setAmount(""); setReference(""); setNote(""); }
                return res;
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor={`${id}-amount`}>{t("roster.payments.amount", { currency })}</Label>
                  <Input id={`${id}-amount`} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <div><Label htmlFor={`${id}-date`}>{t("roster.payments.date")}</Label>
                  <Input id={`${id}-date`} type="date" max={today} required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
                <div><Label htmlFor={`${id}-method`}>{t("roster.payments.method")}</Label>
                  <Select id={`${id}-method`} value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>
                    {METHODS.map((m) => <option key={m} value={m}>{t(`roster.payments.methods.${m}`)}</option>)}
                  </Select></div>
                <div><Label htmlFor={`${id}-ref`}>{t("roster.payments.reference")}</Label>
                  <Input id={`${id}-ref`} maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
              </div>
              <div><Label htmlFor={`${id}-note`}>{t("roster.payments.note")}</Label>
                <Textarea id={`${id}-note`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </ActionDialog>
          </span>
        )}
      </div>

      {installments.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-[0.1em] text-text-muted">{t("roster.money.installments")}</h3>
          <ol className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
            {installments.map((i) => {
              cum += i.amount;
              const settled = cum <= paidSoFar + 0.0001;
              const late = !settled && i.dueOn < today;
              return (
                <li key={i.seq} className="flex justify-between gap-3 border-b border-border py-1 tnum">
                  <span>{i.seq}. {f.date(i.dueOn)}</span>
                  <span className={settled ? "text-success" : late ? "text-danger" : "text-text"}>
                    {fmt(i.amount)} {settled ? `· ${t("roster.money.settled")}` : late ? `· ${t("roster.overdue")}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div>
        <h3 className="text-xs uppercase tracking-[0.1em] text-text-muted">{t("roster.payments.title")}</h3>
        {payments.length === 0 ? <p className="text-sm text-text-muted">{t("roster.payments.none")}</p> : (
          <ul className="mt-1 divide-y divide-border text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={p.voidedAt || p.isReversal ? "text-text-muted" : "text-text"}>
                  <span className="tnum">{f.money(p.amount, p.currency)}</span> · {p.paidAt ? f.date(p.paidAt) : "—"} · {t.dynamic(`roster.payments.methods.${p.method}`, undefined, p.method)}
                  {p.reference ? ` · ${p.reference}` : ""}
                  {p.isReversal && ` · ${t("roster.payments.reversal")}`}
                  {p.voidedAt && <span className="block text-xs">{t("roster.payments.voidedOn", { date: f.date(p.voidedAt), reason: p.voidReason ?? "" })}</span>}
                  {p.note && <span className="block text-xs text-text-muted">{p.note}</span>}
                </span>
                {canRecord && p.isManual && !p.voidedAt && (
                  <ActionDialog
                    trigger={<><RotateCcw className="h-4 w-4" /> {t("roster.payments.reverse")}</>}
                    triggerVariant="ghost"
                    title={t("roster.payments.reverseTitle")}
                    description={t("roster.payments.reverseHint", { amount: f.money(p.amount, p.currency) })}
                    confirmLabel={t("roster.payments.reverse")}
                    danger
                    onConfirm={(reason) => voidRosterPayment(applicationId, p.id, reason)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Accepted, not yet enrolled: enrol now without a payment (admin, reason required). */
export function EnrollNowButton({ applicationId }: { applicationId: string }) {
  const t = useT();
  return (
    <ActionDialog
      trigger={t("roster.enrollNow.button")}
      triggerVariant="secondary"
      title={t("roster.enrollNow.title")}
      description={t("roster.enrollNow.hint")}
      confirmLabel={t("roster.enrollNow.button")}
      reasonLabel={t("roster.enrollNow.reason")}
      onConfirm={(reason) => enrollRosterNow(applicationId, reason)}
    />
  );
}

/** Withdraw the whole enrolment or one tournament (admin). Paid history and the invoice are kept. */
export function WithdrawControls({
  applicationId, balance, currency, tournaments, today,
}: {
  applicationId: string; balance: number | null; currency: string; today: string;
  tournaments: { id: string; name: string; status: "covered" | "withdrawn" }[];
}) {
  const t = useT();
  const f = useFormat();
  const [on, setOn] = React.useState(today);
  const id = React.useId();
  return (
    <div className="flex flex-wrap gap-2">
      {tournaments.filter((x) => x.status === "covered").map((x) => (
        <ActionDialog key={x.id}
          trigger={t("roster.withdraw.tournament", { name: x.name })}
          triggerVariant="ghost"
          title={t("roster.withdraw.tournamentTitle", { name: x.name })}
          description={t("roster.withdraw.tournamentHint")}
          confirmLabel={t("roster.withdraw.confirm")}
          onConfirm={(reason) => withdrawRosterTournament(applicationId, x.id, reason)}
        />
      ))}
      <ActionDialog
        trigger={<><LogOut className="h-4 w-4" /> {t("roster.withdraw.button")}</>}
        triggerVariant="danger"
        title={t("roster.withdraw.title")}
        description={t("roster.withdraw.hint", { balance: balance == null ? "—" : f.money(balance, currency) })}
        confirmLabel={t("roster.withdraw.confirm")}
        danger
        onConfirm={(reason) => withdrawRosterEnrollment(applicationId, { reason, on })}
      >
        <div><Label htmlFor={`${id}-on`}>{t("roster.withdraw.date")}</Label>
          <Input id={`${id}-on`} type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} /></div>
      </ActionDialog>
    </div>
  );
}

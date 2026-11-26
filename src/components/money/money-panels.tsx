"use client";

import * as React from "react";
import { AlertTriangle, Ban, PencilLine, PiggyBank, StickyNote, Wallet } from "lucide-react";
import { Badge, Input, Label, Select } from "@/components/ui";
import { ActionDialog } from "./action-dialog";
import { useFormat, useT } from "@/lib/i18n/client";
import { voidInvoiceAdjustment, transferOverpaymentToCredit, applyFamilyCredit } from "@/lib/actions/invoice-edit";
import { annotatePayment, editPayment, voidPayment } from "@/lib/actions/payments";
import { applicableCredit } from "@/lib/payments/adjustments";

export type AdjustmentView = {
  id: string;
  number: string;
  kind: string;
  amount: number;
  taxAmount: number;
  description: string | null;
  reason: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

/** Credit / debit notes, write-offs and cancellations of one invoice, with void. */
export function AdjustmentList({ adjustments, currency }: { adjustments: AdjustmentView[]; currency: string }) {
  const t = useT();
  const f = useFormat();
  if (!adjustments.length) return <p className="px-5 py-4 text-sm text-ink-3">{t("editMoney.adjust.empty")}</p>;
  return (
    <ul>
      {adjustments.map((a) => {
        const sign = a.kind === "debit_note" ? "+" : "−";
        const voided = Boolean(a.voidedAt);
        return (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
            <div className={voided ? "opacity-60" : undefined}>
              <div className="text-sm text-ink">
                <span className="tnum">{a.number}</span> · {t.dynamic(`editMoney.adjust.kinds.${a.kind}`, undefined, a.kind)}
                {a.description ? ` · ${a.description}` : ""}
              </div>
              <div className="text-xs text-ink-3">
                {f.date(a.createdAt)} · {a.reason}
                {voided && ` · ${t("editMoney.common.voidedBecause", { reason: a.voidReason ?? "" })}`}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`tnum text-sm ${voided ? "text-ink-3 line-through" : "text-ink"}`}>{sign} {f.money(a.amount, currency)}</span>
              {voided ? (
                <Badge tone="neutral">{t("editMoney.common.voided")}</Badge>
              ) : a.kind !== "cancellation" ? (
                <ActionDialog
                  trigger={<><Ban className="h-4 w-4" /> {t("editMoney.common.void")}</>}
                  triggerVariant="ghost"
                  title={t("editMoney.adjust.voidTitle", { number: a.number })}
                  description={t("editMoney.adjust.voidConfirm", { amount: f.money(a.amount, currency) })}
                  confirmLabel={t("editMoney.common.void")}
                  danger
                  onConfirm={(reason) => voidInvoiceAdjustment(a.id, reason)}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export type PaymentView = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string | null;
  notes: string | null;
  adminNote: string | null;
  isStripe: boolean;
  canVoid: boolean;
  canEdit: boolean;
};
export type TargetView = { id: string; number: string; familyName: string; outstanding: number };

const OFFLINE_METHODS = ["bank_transfer", "twint", "manual", "qr_bill", "card"] as const;

/** Edit / re-allocate / void / annotate one payment. Stripe rows: annotate only. */
export function PaymentRowActions({
  payment,
  invoiceId,
  currency,
  targets,
}: {
  payment: PaymentView;
  invoiceId: string;
  currency: string;
  targets: TargetView[];
}) {
  const t = useT();
  const f = useFormat();
  const [amount, setAmount] = React.useState(String(payment.amount));
  const [method, setMethod] = React.useState<string>(OFFLINE_METHODS.includes(payment.method as (typeof OFFLINE_METHODS)[number]) ? payment.method : "manual");
  const [paidOn, setPaidOn] = React.useState(payment.paidAt ? payment.paidAt.slice(0, 10) : "");
  const [reference, setReference] = React.useState(payment.reference ?? "");
  const [note, setNote] = React.useState(payment.notes ?? "");
  const [target, setTarget] = React.useState(invoiceId);
  const [adminNote, setAdminNote] = React.useState(payment.adminNote ?? "");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {payment.canEdit && (
        <ActionDialog
          trigger={<><PencilLine className="h-4 w-4" /> {t("editMoney.common.edit")}</>}
          triggerVariant="ghost"
          title={t("editMoney.payment.editTitle")}
          description={t("editMoney.payment.editHint")}
          confirmLabel={t("editMoney.common.save")}
          onConfirm={(reason) =>
            editPayment(payment.id, {
              amount: Number(amount),
              method: method as (typeof OFFLINE_METHODS)[number],
              paid_on: paidOn || undefined,
              reference,
              note,
              invoice_id: target !== invoiceId ? target : undefined,
              reason,
            })
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`pay-amt-${payment.id}`}>{t("editMoney.common.amountIn", { currency })}</Label>
              <Input id={`pay-amt-${payment.id}`} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`pay-method-${payment.id}`}>{t("editMoney.common.method")}</Label>
              <Select id={`pay-method-${payment.id}`} value={method} onChange={(e) => setMethod(e.target.value)}>
                {OFFLINE_METHODS.map((m) => <option key={m} value={m}>{t.dynamic(`editMoney.methods.${m}`, undefined, m)}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor={`pay-date-${payment.id}`}>{t("editMoney.payment.paidOn")}</Label>
              <Input id={`pay-date-${payment.id}`} type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`pay-ref-${payment.id}`}>{t("editMoney.common.reference")}</Label>
              <Input id={`pay-ref-${payment.id}`} maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor={`pay-note-${payment.id}`}>{t("editMoney.common.note")}</Label>
            <Input id={`pay-note-${payment.id}`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`pay-target-${payment.id}`}>{t("editMoney.payment.allocateTo")}</Label>
            <Select id={`pay-target-${payment.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value={invoiceId}>{t("editMoney.payment.keepInvoice")}</option>
              {targets.map((x) => (
                <option key={x.id} value={x.id}>
                  {t("editMoney.payment.targetOption", { number: x.number, family: x.familyName, amount: f.money(x.outstanding, currency) })}
                </option>
              ))}
            </Select>
            {targets.length === 0 && <p className="mt-1 text-xs text-ink-3">{t("editMoney.payment.noTargets")}</p>}
          </div>
        </ActionDialog>
      )}

      {payment.canVoid && (
        <ActionDialog
          trigger={<><Ban className="h-4 w-4" /> {t("editMoney.common.void")}</>}
          triggerVariant="ghost"
          title={t("editMoney.payment.voidTitle")}
          description={t("editMoney.payment.voidConfirm", { amount: f.money(payment.amount, currency) })}
          confirmLabel={t("editMoney.common.void")}
          danger
          onConfirm={(reason) => voidPayment(payment.id, reason)}
        />
      )}

      <ActionDialog
        trigger={<><StickyNote className="h-4 w-4" /> {t("editMoney.payment.note")}</>}
        triggerVariant="ghost"
        title={t("editMoney.payment.noteTitle")}
        description={payment.isStripe ? t("editMoney.payment.stripeLocked") : undefined}
        confirmLabel={t("editMoney.common.save")}
        askReason={false}
        onConfirm={() => annotatePayment(payment.id, adminNote)}
      >
        <div>
          <Label htmlFor={`pay-admin-note-${payment.id}`}>{t("editMoney.payment.note")}</Label>
          <Input id={`pay-admin-note-${payment.id}`} maxLength={1000} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
        </div>
      </ActionDialog>
    </div>
  );
}

/** Badges explaining special payment rows. */
export function PaymentBadges({ voided, isReversal, methodDetail, isStripe }: { voided: boolean; isReversal: boolean; methodDetail: string | null; isStripe: boolean }) {
  const t = useT();
  return (
    <>
      {voided && <Badge tone="neutral">{t("editMoney.common.voided")}</Badge>}
      {isReversal && <Badge tone="neutral">{t("editMoney.payment.reversal")}</Badge>}
      {methodDetail === "family_credit" && <Badge tone="info">{t("editMoney.payment.fromCredit")}</Badge>}
      {methodDetail === "to_family_credit" && <Badge tone="info">{t("editMoney.payment.toCredit")}</Badge>}
      {isStripe && <Badge tone="accent">{t("editMoney.payment.stripe")}</Badge>}
    </>
  );
}

/** Overpayment flag with "move to family credit". */
export function OverpaymentPanel({ invoiceId, overpaid, currency, familyName }: { invoiceId: string; overpaid: number; currency: string; familyName: string }) {
  const t = useT();
  const f = useFormat();
  if (overpaid <= 0) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> {t("editMoney.overpay.flag", { amount: f.money(overpaid, currency) })} — {t("editMoney.overpay.hint")}
      </span>
      <ActionDialog
        trigger={<><PiggyBank className="h-4 w-4" /> {t("editMoney.overpay.transfer")}</>}
        title={t("editMoney.overpay.transfer")}
        description={t("editMoney.overpay.transferConfirm", { amount: f.money(overpaid, currency), family: familyName })}
        confirmLabel={t("editMoney.overpay.transfer")}
        onConfirm={(reason) => transferOverpaymentToCredit(invoiceId, null, reason)}
      />
    </div>
  );
}

/** Family credit balance with "pay this invoice from credit". */
export function FamilyCreditPanel({
  invoiceId,
  number,
  credit,
  outstanding,
  currency,
  payable,
}: {
  invoiceId: string;
  number: string;
  credit: number;
  outstanding: number;
  currency: string;
  payable: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const usable = applicableCredit(outstanding, credit, currency);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-ink"><Wallet className="h-4 w-4" /> {t("editMoney.credit.balance", { amount: f.money(credit, currency) })}</div>
      {payable && usable > 0 ? (
        <ActionDialog
          trigger={t("editMoney.credit.apply")}
          title={t("editMoney.credit.apply")}
          description={t("editMoney.credit.applyConfirm", { amount: f.money(usable, currency), number })}
          confirmLabel={t("editMoney.credit.apply")}
          onConfirm={(reason) => applyFamilyCredit(invoiceId, usable, reason)}
        />
      ) : (
        credit <= 0 && <p className="text-xs text-ink-3">{t("editMoney.credit.none")}</p>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { recordManualPayment } from "@/lib/actions/invoice";
import { useFormat, useT } from "@/lib/i18n/client";

const METHODS = ["bank_transfer", "qr_bill", "twint", "manual", "card"] as const;
type Method = (typeof METHODS)[number];

/** Record an offline payment (cash, bank transfer, QR-bill, TWINT to the club's number) with its real date. */
export function ManualPaymentForm({ invoiceId, balance, currency }: { invoiceId: string; balance: number; currency: string }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = React.useState(balance > 0 ? String(balance) : "");
  const [method, setMethod] = React.useState<Method>("bank_transfer");
  const [paidOn, setPaidOn] = React.useState(today);
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!(value > 0)) return setError(t("editMoney.errors.INVALID_AMOUNT"));
    const msg = value > balance
      ? t("editMoney.payment.recordOverConfirm", { amount: f.money(value, currency), balance: f.money(Math.max(0, balance), currency) })
      : t("editMoney.payment.recordConfirm", { amount: f.money(value, currency) });
    if (!window.confirm(msg)) return;
    setPending(true);
    setError(null);
    const res = await recordManualPayment(invoiceId, { amount: value, method, paid_on: paidOn, reference, note });
    setPending(false);
    if (!res.ok) setError(res.error);
    else { setReference(""); setNote(""); router.refresh(); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="amt">{t("editMoney.common.amountIn", { currency })}</Label>
          <Input id="amt" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="method">{t("editMoney.common.method")}</Label>
          <Select id="method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            {METHODS.map((m) => <option key={m} value={m}>{t.dynamic(`editMoney.methods.${m}`, undefined, m)}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="paid-on">{t("editMoney.payment.paidOn")}</Label>
        <Input id="paid-on" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </div>
      <div><Label htmlFor="ref">{t("editMoney.common.referenceOptional")}</Label><Input id="ref" maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      <div><Label htmlFor="note">{t("editMoney.common.noteOptional")}</Label><Input id="note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="sm" disabled={pending}>{pending ? t("editMoney.common.working") : t("editMoney.payment.record")}</Button>
    </form>
  );
}

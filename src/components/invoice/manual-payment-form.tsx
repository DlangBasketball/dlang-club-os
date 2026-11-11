"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { recordManualPayment } from "@/lib/actions/invoice";

export function ManualPaymentForm({ invoiceId, balance }: { invoiceId: string; balance: number }) {
  const router = useRouter();
  const [amount, setAmount] = React.useState(balance > 0 ? String(balance) : "");
  const [method, setMethod] = React.useState("bank_transfer");
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await recordManualPayment(invoiceId, { amount: Number(amount), method: method as "bank_transfer" | "twint" | "manual" | "card", reference, note });
    setPending(false);
    if (!res.ok) setError(res.error);
    else { setReference(""); setNote(""); router.refresh(); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="amt">Amount (CHF)</Label><Input id="amt" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div>
          <Label htmlFor="method">Method</Label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink">
            <option value="bank_transfer">Bank transfer</option>
            <option value="twint">TWINT</option>
            <option value="manual">Cash / manual</option>
            <option value="card">Card (offline)</option>
          </select>
        </div>
      </div>
      <div><Label htmlFor="ref">Reference (optional)</Label><Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      <div><Label htmlFor="note">Note (optional)</Label><Input id="note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Recording…" : "Record payment"}</Button>
    </form>
  );
}

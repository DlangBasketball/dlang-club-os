"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { ActionDialog } from "@/components/money/action-dialog";
import { useFormat, useT } from "@/lib/i18n/client";
import { allocateReceipt, voidReceipt } from "@/lib/actions/billing";
import { voidPayment } from "@/lib/actions/payments";
import type { PayerContext } from "@/lib/data/player-billing";
import { autoAllocate, validateAllocations } from "@/lib/billing/player-billing";
import { newRequestId } from "@/lib/billing/request-id";
import { AllocationList } from "./allocation-list";
import { PayerSearch } from "./player-search";

/** Reverse one allocation: the existing payment void (reason required); the money is unallocated on the receipt again. */
export function ReverseAllocationButton({ paymentId, label }: { paymentId: string; label: string }) {
  const t = useT();
  return (
    <ActionDialog
      trigger={<><Undo2 className="h-4 w-4" aria-hidden /> {t("playerBilling.receipts.reverse")}</>}
      triggerVariant="ghost"
      danger
      title={t("playerBilling.receipts.reverseTitle")}
      description={t("playerBilling.receipts.reverseHint", { invoice: label })}
      confirmLabel={t("playerBilling.receipts.reverse")}
      onConfirm={(reason) => voidPayment(paymentId, reason)}
    />
  );
}

/** Void a receipt that has nothing allocated (entered twice, wrong amount). */
export function VoidReceiptButton({ receiptId }: { receiptId: string }) {
  const t = useT();
  return (
    <ActionDialog
      trigger={t("playerBilling.receipts.void")}
      triggerVariant="ghost"
      danger
      title={t("playerBilling.receipts.voidTitle")}
      description={t("playerBilling.receipts.voidHint")}
      confirmLabel={t("playerBilling.receipts.void")}
      onConfirm={(reason) => voidReceipt({ receiptId, reason })}
    />
  );
}

/**
 * Allocate what is left on a receipt to the payer's open invoices
 * (receipt_allocate, one request id per page open). Without a payer on the
 * receipt, the user first chooses the family.
 */
export function AllocateReceiptForm({ receiptId, unallocated, currency, payer, receiptHref }: {
  receiptId: string; unallocated: number; currency: string; payer: PayerContext | null; receiptHref: string;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [requestId, setRequestId] = React.useState(newRequestId);
  const [alloc, setAlloc] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  if (!payer) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-text-secondary">{t("playerBilling.receipts.choosePayer")}</p>
        <PayerSearch onSelect={(h) => router.push(`${receiptHref}?family=${h.familyId}`)} />
      </div>
    );
  }
  const invoices = payer.openInvoices;
  const check = validateAllocations({
    receiptAmount: unallocated, currency,
    drafts: Object.entries(alloc).map(([invoiceId, amount]) => ({ invoiceId, amount })),
    invoices: invoices.map((i) => ({ id: i.id, currency: i.currency, balance: i.balance })),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!check.allocations.length) return setError(t("playerBilling.allocation.nothing"));
    if (!check.ok) return setError(check.error ? t(`playerBilling.allocation.${check.error}`) : t("playerBilling.allocation.fixRows"));
    setBusy(true);
    setError(null);
    const res = await allocateReceipt({ receiptId, requestId, allocations: check.allocations });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDone(res.message ?? t("billing.receipts.allocated"));
    setAlloc({});
    setRequestId(newRequestId());
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">{t("playerBilling.receipts.allocateHint", { amount: f.money(unallocated, currency), payer: payer.familyName })}</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => {
          const ordered = [...invoices].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
          const next: Record<string, string> = {};
          for (const a of autoAllocate(unallocated, currency, ordered)) next[a.invoiceId] = String(a.amount);
          setAlloc(next);
        }}>{t("playerBilling.record.autoFill")}</Button>
      </div>
      <AllocationList invoices={invoices} currency={currency} alloc={alloc} onChange={(v) => { setAlloc(v); setDone(null); }} rowErrors={check.rowErrors} />
      <p className="text-sm text-text-secondary" aria-live="polite">
        {t("playerBilling.receipts.afterAllocation", { allocated: f.money(check.allocated, currency), left: f.money(check.unallocated, currency) })}
      </p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {done && <p role="status" className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> {done}</p>}
      <Button type="submit" disabled={busy || unallocated <= 0}>{busy ? t("common.saving") : t("playerBilling.receipts.allocate")}</Button>
    </form>
  );
}

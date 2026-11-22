"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Wand2 } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { recordReceipt, type ReceiptSummary } from "@/lib/actions/billing";
import type { PayerContext } from "@/lib/data/player-billing";
import { autoAllocate, parseAmount, validateAllocations } from "@/lib/billing/player-billing";
import { newRequestId } from "@/lib/billing/request-id";
import { CategoryPill } from "./category-pill";
import { PayerSearch } from "./player-search";
import { AllocationList } from "./allocation-list";

const METHODS = ["bank_transfer", "twint", "qr_bill", "card", "manual"] as const;
type Method = (typeof METHODS)[number];

/**
 * Record one received amount and allocate it explicitly to the payer's open
 * invoices, grouped by revenue category (Club and EYBL stay separate). Each
 * allocation shows the instalments it settles; whatever is not allocated
 * stays on the receipt as "unallocated" (Payments → Unallocated receipts).
 * Uses receipt_record with a request id created once per form open.
 */
export function RecordPaymentForm({ payer, preselectInvoiceId, defaultCurrency, today }: {
  payer: PayerContext | null; preselectInvoiceId: string | null; defaultCurrency: string; today: string;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const id = React.useId();
  const [requestId] = React.useState(newRequestId);
  const invoices = React.useMemo(() => payer?.openInvoices ?? [], [payer]);
  const pre = invoices.find((i) => i.id === preselectInvoiceId) ?? null;
  const [currency] = React.useState(pre?.currency ?? invoices[0]?.currency ?? defaultCurrency);
  const [amount, setAmount] = React.useState(pre ? String(pre.balance) : "");
  const [receivedOn, setReceivedOn] = React.useState(today);
  const [method, setMethod] = React.useState<Method>("bank_transfer");
  const [reference, setReference] = React.useState("");
  const [payerName, setPayerName] = React.useState(payer?.contactName ?? "");
  const [note, setNote] = React.useState("");
  const [alloc, setAlloc] = React.useState<Record<string, string>>(pre ? { [pre.id]: String(pre.balance) } : {});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ReceiptSummary | null>(null);

  if (!payer) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">{t("playerBilling.record.choosePayer")}</p>
        <PayerSearch autoFocus onSelect={(h) => router.push(`/admin/payments/record?family=${h.familyId}`)} />
      </div>
    );
  }

  const check = validateAllocations({
    receiptAmount: amount, currency,
    drafts: Object.entries(alloc).map(([invoiceId, a]) => ({ invoiceId, amount: a })),
    invoices: invoices.map((i) => ({ id: i.id, currency: i.currency, balance: i.balance })),
  });
  const money = (n: number) => f.money(n, currency);

  function fill() {
    const v = parseAmount(amount);
    if (v == null || !Number.isFinite(v) || v <= 0) return setError(t("billing.errors.INVALID_AMOUNT"));
    setError(null);
    // Oldest due first, across categories (each still booked on its own invoice).
    const ordered = [...invoices].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    const next: Record<string, string> = {};
    for (const a of autoAllocate(v, currency, ordered)) next[a.invoiceId] = String(a.amount);
    setAlloc(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!check.ok) return setError(check.error ? t(`playerBilling.allocation.${check.error}`) : t("playerBilling.allocation.fixRows"));
    setBusy(true);
    setError(null);
    const res = await recordReceipt({
      requestId, familyId: payer!.familyId, payerName: payerName || null, amount: parseAmount(amount) ?? 0, currency,
      receivedOn, method, reference: reference || null, note: note || null, allocations: check.allocations,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setResult(res.data ?? null);
    router.refresh();
  }

  if (result) {
    return (
      <div className="space-y-4" role="status">
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> {result.replayed ? t("playerBilling.record.alreadyRecorded") : t("billing.receipts.recorded")}
        </p>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          {([["received", result.amount], ["allocated", result.allocated], ["unallocated", result.unallocated]] as const).map(([k, v]) => (
            <div key={k}><dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t(`playerBilling.record.${k}`)}</dt><dd className="font-display text-lg tnum text-text">{f.money(v, result.currency)}</dd></div>
          ))}
        </dl>
        {result.allocations.length > 0 && (
          <ul className="divide-y divide-border-soft rounded-md border border-border">
            {result.allocations.map((a) => (
              <li key={a.payment_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="flex items-center gap-2"><Link href={`/admin/invoices/${a.invoice_id}`} className="tnum text-brand-primary hover:underline">{a.invoice_number}</Link><CategoryPill category={a.activity} /></span>
                <span className="tnum">{f.money(a.amount, result.currency)}</span>
              </li>
            ))}
          </ul>
        )}
        {result.unallocated > 0 && <p className="text-sm text-warning">{t("playerBilling.record.unallocatedHint")}</p>}
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/payments?view=receipts"><Button size="sm" variant="secondary">{t("playerBilling.receipts.title")}</Button></Link>
          <Link href="/admin/payments/record"><Button size="sm" variant="ghost">{t("playerBilling.record.another")}</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2">
        <span>
          <Link href={`/admin/families/${payer.familyId}`} className="font-medium text-text hover:text-brand-primary">{payer.familyName}</Link>
          {payer.athletes.length > 0 && (
            <span className="ml-2 text-xs text-text-muted">
              {payer.athletes.map((a, k) => <React.Fragment key={a.id}>{k > 0 && ", "}<Link href={`/admin/athletes/${a.id}?tab=billing`} className="hover:underline">{a.name}</Link></React.Fragment>)}
            </span>
          )}
        </span>
        <Link href="/admin/payments/record" className="text-xs text-brand-primary hover:underline">{t("playerBilling.record.changePayer")}</Link>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${id}-amount`}>{t("playerBilling.record.amount", { currency })}</Label>
          <Input id={`${id}-amount`} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-date`}>{t("playerBilling.record.receivedOn")}</Label>
          <Input id={`${id}-date`} type="date" max={today} required value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-method`}>{t("playerBilling.record.method")}</Label>
          <Select id={`${id}-method`} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            {METHODS.map((m) => <option key={m} value={m}>{t(`roster.payments.methods.${m}`)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${id}-ref`}>{t("playerBilling.record.reference")}</Label>
          <Input id={`${id}-ref`} maxLength={140} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-payer`}>{t("playerBilling.record.payerName")}</Label>
          <Input id={`${id}-payer`} maxLength={140} value={payerName} onChange={(e) => setPayerName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-note`}>{t("playerBilling.record.note")}</Label>
          <Textarea id={`${id}-note`} rows={1} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg text-text">{t("playerBilling.record.openInvoices")}</h2>
          {invoices.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={fill}><Wand2 className="h-4 w-4" aria-hidden /> {t("playerBilling.record.autoFill")}</Button>}
        </div>
        <AllocationList invoices={invoices} currency={currency} alloc={alloc} onChange={setAlloc} rowErrors={check.rowErrors} />
      </section>

      <dl className="grid grid-cols-3 gap-3 rounded-md border border-border bg-surface-elevated p-3 text-sm" aria-live="polite">
        <div><dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("playerBilling.record.received")}</dt><dd className="font-display text-lg tnum text-text">{money(Math.max(parseAmount(amount) ?? 0, 0) || 0)}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("playerBilling.record.allocated")}</dt><dd className="font-display text-lg tnum text-text">{money(check.allocated)}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("playerBilling.record.unallocated")}</dt><dd className={`font-display text-lg tnum ${check.unallocated > 0 ? "text-warning" : "text-text"}`}>{money(check.unallocated)}</dd></div>
      </dl>
      {check.error === "ALLOCATION_EXCEEDS_RECEIPT" && <p role="alert" className="text-sm text-danger">{t("playerBilling.allocation.ALLOCATION_EXCEEDS_RECEIPT")}</p>}
      {check.unallocated > 0 && check.error === null && <p className="text-xs text-text-muted">{t("playerBilling.record.unallocatedHint")}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("playerBilling.record.submit")}</Button>
    </form>
  );
}

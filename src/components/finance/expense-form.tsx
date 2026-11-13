"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Trash2, Upload } from "lucide-react";
import { Button, Card, CardBody, FieldHint, Input, Label, Select, Textarea } from "@/components/ui";
import { removeExpenseReceipt, saveExpense, uploadExpenseReceipt } from "@/lib/actions/finance";
import { EXPENSE_METHODS, RECEIPT_TYPES, type ExpenseMethod } from "@/lib/finance/validation";
import { useFormat, useT } from "@/lib/i18n/client";

type Opt = { id: string; name: string; active?: boolean };
export type ExpenseFormValue = {
  id: string; date: string; amount: number; currency: string; status: "paid" | "unpaid"; paidOn: string | null;
  categoryId: string | null; supplierId: string | null; coachId: string | null; programId: string | null;
  campEditionId: string | null; teamId: string | null; venueId: string | null; description: string | null;
  method: string; recurringMonthly: boolean; isRecurringCopy: boolean; hasReceipt: boolean; receiptName: string | null; payoutId: string | null;
};

/** Options list that keeps an inactive entry visible when the expense already uses it. */
const visible = (opts: Opt[], current: string | null) => opts.filter((o) => o.active !== false || o.id === current);

export function ExpenseForm({ expense, options, currencies, today }: {
  expense?: ExpenseFormValue; currencies: string[]; today: string;
  options: { categories: Opt[]; suppliers: Opt[]; coaches: Opt[]; programs: Opt[]; camps: Opt[]; teams: Opt[]; venues: Opt[] };
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [v, setV] = React.useState({
    date: expense?.date ?? today, amount: expense ? String(expense.amount) : "", currency: expense?.currency ?? f.currency,
    categoryId: expense?.categoryId ?? "", supplierId: expense?.supplierId ?? "", coachId: expense?.coachId ?? "",
    programId: expense?.programId ?? "", campEditionId: expense?.campEditionId ?? "", teamId: expense?.teamId ?? "",
    venueId: expense?.venueId ?? "", description: expense?.description ?? "", method: (expense?.method ?? "bank_transfer") as ExpenseMethod,
    status: expense?.status ?? ("unpaid" as "paid" | "unpaid"), paidOn: expense?.paidOn ?? "", recurringMonthly: expense?.recurringMonthly ?? false,
  });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const curOptions = Array.from(new Set([v.currency, ...currencies]));
  const locked = !!expense?.payoutId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await saveExpense(expense?.id ?? null, {
      date: v.date, amount: Number(v.amount), currency: v.currency, categoryId: v.categoryId, supplierId: v.supplierId, coachId: v.coachId,
      programId: v.programId, campEditionId: v.campEditionId, teamId: v.teamId, venueId: v.venueId, description: v.description,
      method: v.method, status: v.status, paidOn: v.status === "paid" ? v.paidOn : "", recurringMonthly: expense?.isRecurringCopy ? false : v.recurringMonthly,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: res.message ?? "" });
    if (!expense && res.id) router.push(`/admin/finance/expenses/${res.id}`);
    else router.refresh();
  }

  const sel = (id: keyof typeof v, label: string, opts: Opt[]) => (
    <div>
      <Label htmlFor={`exp-${id}`}>{label}</Label>
      <Select id={`exp-${id}`} value={String(v[id])} onChange={(e) => set(id, e.target.value as never)}>
        <option value="">{t("finance.common.none")}</option>
        {visible(opts, String(v[id]) || null).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card><CardBody className="space-y-4">
        {locked && <p className="text-sm text-ink-3">{t("finance.expenses.payoutLocked")}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div><Label htmlFor="exp-date">{t("finance.common.date")}</Label><Input id="exp-date" type="date" required value={v.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div><Label htmlFor="exp-amount">{t("finance.common.amount")}</Label><Input id="exp-amount" type="number" inputMode="decimal" step="0.01" min="0.01" required value={v.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <div>
            <Label htmlFor="exp-cur">{t("finance.filters.currency")}</Label>
            <Select id="exp-cur" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
              {curOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sel("categoryId", t("finance.expenses.category"), options.categories)}
          {sel("supplierId", t("finance.expenses.supplier"), options.suppliers)}
        </div>
        <div>
          <Label htmlFor="exp-desc">{t("finance.common.description")}</Label>
          <Textarea id="exp-desc" rows={2} maxLength={1000} value={v.description} onChange={(e) => set("description", e.target.value)} />
        </div>
      </CardBody></Card>

      <Card><CardBody className="space-y-4">
        <p className="text-sm font-medium text-ink">{t("finance.expenses.links")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sel("coachId", t("finance.expenses.coach"), options.coaches)}
          {sel("programId", t("finance.expenses.program"), options.programs)}
          {sel("campEditionId", t("finance.expenses.camp"), options.camps)}
          {sel("teamId", t("finance.expenses.team"), options.teams)}
          {sel("venueId", t("finance.expenses.location"), options.venues)}
        </div>
      </CardBody></Card>

      <Card><CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="exp-method">{t("finance.common.method")}</Label>
            <Select id="exp-method" value={v.method} onChange={(e) => set("method", e.target.value as ExpenseMethod)}>
              {EXPENSE_METHODS.map((m) => <option key={m} value={m}>{t(`finance.methods.${m}`)}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="exp-status">{t("finance.common.status")}</Label>
            <Select id="exp-status" value={v.status} disabled={locked} onChange={(e) => set("status", e.target.value as "paid" | "unpaid")}>
              <option value="unpaid">{t("finance.expenses.statuses.unpaid")}</option>
              <option value="paid">{t("finance.expenses.statuses.paid")}</option>
            </Select>
          </div>
          {v.status === "paid" && (
            <div><Label htmlFor="exp-paid-on">{t("finance.expenses.paidOn")}</Label><Input id="exp-paid-on" type="date" value={v.paidOn} onChange={(e) => set("paidOn", e.target.value)} /></div>
          )}
        </div>
        {!expense?.isRecurringCopy && (
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" className="mt-1" checked={v.recurringMonthly} onChange={(e) => set("recurringMonthly", e.target.checked)} />
            <span>{t("finance.expenses.recurringMonthly")}<FieldHint>{t("finance.expenses.recurringHint")}</FieldHint></span>
          </label>
        )}
        {expense?.isRecurringCopy && <p className="text-xs text-ink-3">{t("finance.expenses.recurringCopy")}</p>}
      </CardBody></Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || locked}>{busy ? t("common.saving") : t("common.save")}</Button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
      </div>
    </form>
  );
}

/** Receipt upload / view / remove for one expense (private bucket, signed URL on view). */
export function ReceiptPanel({ expenseId, hasReceipt, receiptName }: { expenseId: string; hasReceipt: boolean; receiptName: string | null }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    const fd = new FormData();
    fd.set("expenseId", expenseId);
    fd.set("file", file);
    setBusy(true); setMsg(null);
    const res = await uploadExpenseReceipt(fd);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (inputRef.current) inputRef.current.value = "";
    if (res.ok) router.refresh();
  }
  async function remove() {
    if (!window.confirm(t("finance.receipt.confirmRemove"))) return;
    setBusy(true); setMsg(null);
    const res = await removeExpenseReceipt(expenseId);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <Card><CardBody className="space-y-3">
      <p className="text-sm font-medium text-ink">{t("finance.receipt.title")}</p>
      {hasReceipt ? (
        <div className="flex flex-wrap items-center gap-3">
          <a href={`/admin/finance/expenses/${expenseId}/receipt`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-ink hover:text-maroon">
            <FileText className="h-4 w-4" aria-hidden /> {receiptName ?? t("finance.receipt.view")}
          </a>
          <Button size="sm" variant="ghost" disabled={busy} onClick={remove}><Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("finance.receipt.remove")}</Button>
        </div>
      ) : <p className="text-sm text-ink-3">{t("finance.receipt.none")}</p>}
      <div>
        <Label htmlFor={`receipt-${expenseId}`}>{hasReceipt ? t("finance.receipt.replace") : t("finance.receipt.upload")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input ref={inputRef} id={`receipt-${expenseId}`} type="file" accept={RECEIPT_TYPES.join(",")} disabled={busy}
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} className="max-w-xs" />
          {busy && <Upload className="h-4 w-4 animate-pulse text-ink-3" aria-hidden />}
        </div>
        <FieldHint>{t("finance.receipt.hint")}</FieldHint>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </CardBody></Card>
  );
}

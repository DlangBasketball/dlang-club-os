"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil, Repeat, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { deleteExpense, generateRecurringExpenses, setExpenseStatus, type FinanceResult } from "@/lib/actions/finance";
import { useT } from "@/lib/i18n/client";

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
  const status = msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>;
  return { busy, run, status };
}

/** Row actions in the expenses list: edit, mark paid / unpaid, delete (with reason). */
export function ExpenseRowActions({ id, status, isPayout }: { id: string; status: "paid" | "unpaid"; isPayout: boolean }) {
  const t = useT();
  const { busy, run, status: note } = useAct();
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Link href={`/admin/finance/expenses/${id}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-ink-2 hover:bg-surface-elevated hover:text-ink">
        <Pencil className="h-3.5 w-3.5" aria-hidden /> {t("common.edit")}
      </Link>
      {status === "unpaid" ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => setExpenseStatus(id, "paid"))}><Check className="h-3.5 w-3.5" aria-hidden /> {t("finance.expenses.markPaid")}</Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={busy || isPayout} onClick={() => run(() => setExpenseStatus(id, "unpaid"))}><Undo2 className="h-3.5 w-3.5" aria-hidden /> {t("finance.expenses.markUnpaid")}</Button>
      )}
      {!isPayout && (
        <Button size="sm" variant="danger" disabled={busy} aria-label={t("finance.expenses.delete")}
          onClick={() => {
            const reason = window.prompt(t("finance.expenses.deleteReasonPrompt"));
            if (reason && reason.trim()) run(() => deleteExpense(id, reason));
          }}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
      {note}
    </div>
  );
}

export function RecurringButton() {
  const t = useT();
  const { busy, run, status } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => generateRecurringExpenses())}>
        <Repeat className="h-4 w-4" aria-hidden /> {t("finance.expenses.postRecurring")}
      </Button>
      {status}
    </span>
  );
}

/** Delete button on the expense edit page (navigates back to the list). */
export function DeleteExpenseButton({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, run, status } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="danger" disabled={busy} onClick={() => {
        const reason = window.prompt(t("finance.expenses.deleteReasonPrompt"));
        if (reason && reason.trim()) run(() => deleteExpense(id, reason), () => router.push("/admin/finance?tab=expenses"));
      }}><Trash2 className="h-4 w-4" aria-hidden /> {t("finance.expenses.delete")}</Button>
      {status}
    </span>
  );
}

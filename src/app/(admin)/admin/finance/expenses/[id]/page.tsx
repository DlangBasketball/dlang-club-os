import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ExpenseForm, ReceiptPanel } from "@/components/finance/expense-form";
import { DeleteExpenseButton } from "@/components/finance/expense-actions";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getExpense, loadRefs, todayKey } from "@/lib/finance/data";
import { isUuid } from "@/lib/finance/params";
import { PROGRAM_CURRENCIES } from "@/lib/club-ops/validation";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("finance.expenses.edit") };
}

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const [me, { t, f, ctx }, { id }] = await Promise.all([getSessionUser(), getI18n(), params]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  if (!isUuid(id)) notFound();
  const [expense, refs] = await Promise.all([getExpense(me.orgId, id), loadRefs(me.orgId)]);
  if (!expense) notFound();
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader
        eyebrow={<Link href="/admin/finance?tab=expenses" className="hover:text-ink">{t("finance.title")}</Link>}
        title={t("finance.expenses.edit")}
        description={t("finance.expenses.editDescription", { amount: f.money(expense.amount, expense.currency), date: f.date(expense.date) })}
        actions={expense.payoutId ? undefined : <DeleteExpenseButton id={expense.id} />}
      />
      <ExpenseForm expense={expense} options={refs} currencies={Array.from(new Set([ctx.currency, ...PROGRAM_CURRENCIES]))} today={todayKey()} />
      <ReceiptPanel expenseId={expense.id} hasReceipt={expense.hasReceipt} receiptName={expense.receiptName} />
    </div>
  );
}

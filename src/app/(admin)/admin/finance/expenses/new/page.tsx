import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ExpenseForm } from "@/components/finance/expense-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { loadRefs, todayKey } from "@/lib/finance/data";
import { PROGRAM_CURRENCIES } from "@/lib/club-ops/validation";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("finance.expenses.new") };
}

export default async function NewExpensePage() {
  const [me, { t, ctx }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const refs = await loadRefs(me.orgId);
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader
        eyebrow={<Link href="/admin/finance?tab=expenses" className="hover:text-ink">{t("finance.title")}</Link>}
        title={t("finance.expenses.new")}
        description={t("finance.expenses.newDescription")}
      />
      <ExpenseForm options={refs} currencies={Array.from(new Set([ctx.currency, ...PROGRAM_CURRENCIES]))} today={todayKey()} />
    </div>
  );
}

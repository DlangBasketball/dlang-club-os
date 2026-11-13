import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { FinanceNav } from "@/components/finance/finance-nav";
import { ListManager } from "@/components/finance/list-manager";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { loadRefs } from "@/lib/finance/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("finance.lists.title") };
}

export default async function FinanceListsPage() {
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const refs = await loadRefs(me.orgId);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        eyebrow={<Link href="/admin/finance?tab=expenses" className="hover:text-ink">{t("finance.title")}</Link>}
        title={t("finance.lists.title")}
        description={t("finance.lists.description")}
      />
      <FinanceNav t={t} active="expenses" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ListManager kind="category" items={refs.categories} />
        <ListManager kind="supplier" items={refs.suppliers} />
      </div>
    </div>
  );
}

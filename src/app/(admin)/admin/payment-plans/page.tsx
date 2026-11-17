import Link from "next/link";
import { redirect } from "next/navigation";
import { Repeat, Settings } from "lucide-react";
import { Badge, DataTable, EmptyState, PageHeader, StatCard, buttonVariants, type Column } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listFailedCharges, listPlans, type PlanFilter, type PlanView } from "@/lib/plans/data";
import { instalmentTone } from "@/components/plans/instalment-table";
import { RetryChargeButton } from "@/components/plans/plan-widgets";

const FILTERS: PlanFilter[] = ["all", "active", "overdue", "failed", "paused", "completed", "cancelled"];

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("plans.admin.title") };
}

/** Instalment plans overview: by status, overdue, failed autopay charges. */
export default async function PaymentPlansPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const [me, { t, f }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const filter: PlanFilter = (FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as PlanFilter) : "all";
  const [plans, all, failed] = await Promise.all([listPlans(me.orgId, filter), listPlans(me.orgId, "all"), listFailedCharges(me.orgId)]);

  const live = all.filter((p) => p.rawStatus === "active" || p.rawStatus === "paused");
  const byCur = new Map<string, number>();
  for (const p of live) byCur.set(p.currency, (byCur.get(p.currency) ?? 0) + p.outstanding);
  const outstanding = Array.from(byCur.entries()).map(([c, n]) => f.money(n, c)).join(" · ") || f.money(0);

  const cols: Column<PlanView & Record<string, unknown>>[] = [
    { key: "invoice", header: t("plans.common.invoice"), render: (p) => p.invoiceId
      ? <Link href={`/admin/invoices/${p.invoiceId}`} className="tnum text-maroon hover:underline">{p.invoiceNumber ?? "—"}</Link> : "—" },
    { key: "family", header: t("plans.common.family"), render: (p) => p.familyName },
    { key: "count", header: t("plans.common.instalments"), render: (p) => {
      const paid = p.instalments.filter((i) => i.status === "paid").length;
      return t("plans.admin.paidOf", { paid, count: p.count });
    } },
    { key: "next", header: t("plans.common.nextDue"), render: (p) => p.nextDue ? `${f.date(p.nextDue.dueDate)} · ${f.money(p.nextDue.outstanding, p.currency)}` : "—" },
    { key: "outstanding", header: t("plans.common.outstanding"), align: "right", render: (p) => <span className="tnum">{f.money(p.outstanding, p.currency)}</span> },
    { key: "status", header: t("plans.common.status"), render: (p) => (
      <span className="flex flex-wrap gap-1">
        <Badge tone={instalmentTone(p.status === "active" ? "upcoming" : p.status === "completed" ? "paid" : p.status)}>{t.dynamic(`plans.planStatus.${p.status}`, undefined, p.status)}</Badge>
        {p.failedCharges > 0 && <Badge tone="danger">{t("plans.admin.failedCount", { count: p.failedCharges })}</Badge>}
      </span>
    ) },
    { key: "open", header: "", align: "right", render: (p) => <Link href={`/admin/payment-plans/${p.id}`} className="text-sm text-maroon hover:underline">{t("plans.admin.open")}</Link> },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("plans.admin.title")} description={t("plans.admin.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/recurring-fees" className={buttonVariants({ variant: "secondary", size: "sm" })}><Repeat className="h-4 w-4" /> {t("plans.recurring.title")}</Link>
            <Link href="/admin/payment-plans/settings" className={buttonVariants({ variant: "secondary", size: "sm" })}><Settings className="h-4 w-4" /> {t("plans.settings.title")}</Link>
          </div>
        } />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={t("plans.admin.statActive")} value={String(live.length)} />
        <StatCard label={t("plans.admin.statOverdue")} value={String(all.filter((p) => p.status === "overdue").length)} tone="danger" />
        <StatCard label={t("plans.admin.statFailed")} value={String(failed.length)} tone="warning" />
        <StatCard label={t("plans.common.outstanding")} value={outstanding} accent />
      </div>

      <nav className="flex flex-wrap gap-2" aria-label={t("plans.admin.filters")}>
        {FILTERS.map((x) => (
          <Link key={x} href={x === "all" ? "/admin/payment-plans" : `/admin/payment-plans?filter=${x}`} aria-current={x === filter ? "page" : undefined}
            className={buttonVariants({ variant: x === filter ? "primary" : "secondary", size: "sm" })}>{t.dynamic(`plans.admin.filter.${x}`, undefined, x)}</Link>
        ))}
      </nav>

      <DataTable columns={cols} rows={plans as (PlanView & Record<string, unknown>)[]} getRowKey={(p) => p.id} caption={t("plans.admin.title")}
        empty={<EmptyState title={t("plans.admin.empty")} description={t("plans.admin.emptyHint")} />} />

      {failed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("plans.admin.failedTitle")}</h2>
          <DataTable caption={t("plans.admin.failedTitle")} rows={failed as (typeof failed[number] & Record<string, unknown>)[]} getRowKey={(c) => c.id}
            columns={[
              { key: "date", header: t("plans.common.date"), render: (c) => f.date(c.created_at) },
              { key: "family", header: t("plans.common.family"), render: (c) => c.familyName },
              { key: "invoice", header: t("plans.common.invoice"), render: (c) => <Link href={`/admin/invoices/${c.invoice_id}`} className="tnum text-maroon hover:underline">{c.invoiceNumber ?? "—"}</Link> },
              { key: "amount", header: t("plans.common.amount"), align: "right", render: (c) => <span className="tnum">{f.money(c.amount, c.currency)}</span> },
              { key: "reason", header: t("plans.admin.failure"), render: (c) => t.dynamic(`plans.autopay.status.${c.autopayStatus ?? c.status}`, { date: c.next_retry_on ? f.date(c.next_retry_on) : "" }, c.status) + (c.decline_code || c.failure_code ? ` · ${c.decline_code ?? c.failure_code}` : "") },
              { key: "retry", header: "", align: "right", render: (c) => (c.instalmentStatus === "scheduled" || c.instalmentStatus === "invoiced") ? <RetryChargeButton installmentId={c.installment_id} /> : null },
            ]} />
        </section>
      )}
    </div>
  );
}

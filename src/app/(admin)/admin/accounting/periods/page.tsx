import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader } from "@/components/ui";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { ClosePeriodForm, ReopenPeriodButton } from "@/components/accounting/admin-forms";
import { FinTable } from "@/components/finance/fin-table";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listLocks } from "@/lib/accounting/data";
import { formatMonth } from "@/lib/finance/params";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.periods.title") };
}

/** Close months (lock invoices, payments and expenses dated in them); admins reopen with a reason. */
export default async function PeriodsPage() {
  const [me, { t, f, ctx }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const locks = await listLocks(me.orgId);
  const today = new Date().toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const isAdmin = me.roles.includes("admin");
  const monthLabel = (d: string) => formatMonth(ctx.locale, d.slice(0, 7));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("accounting.periods.title")} description={t("accounting.periods.description")} />
      <AccountingNav t={t} active="periods" />
      <Card>
        <CardHeader><CardTitle>{t("accounting.periods.close")}</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          <ClosePeriodForm defaultMonth={prev} maxMonth={prev} />
          <p className="text-xs text-ink-3">{t("accounting.periods.closeHint")}</p>
        </CardBody>
      </Card>
      {locks.error !== null ? <ErrorState message={locks.error} /> : (
        <FinTable
          title={t("accounting.periods.history")} caption={t("accounting.periods.history")} rows={locks.data} rowKey={(r) => r.id}
          empty={t("accounting.periods.empty")}
          subtitle={isAdmin ? undefined : t("accounting.periods.adminOnly")}
          cols={[
            { key: "month", header: t("accounting.periods.month"), cell: (r) => monthLabel(r.period_start) },
            { key: "status", header: t("accounting.common.status"), cell: (r) => r.reopened_at
              ? <Badge tone="neutral">{t("accounting.periods.statusReopened")}</Badge>
              : <Badge tone="success">{t("accounting.periods.statusClosed")}</Badge> },
            { key: "closed", header: t("accounting.periods.closedOn"), cell: (r) => f.dateTime(r.closed_at) },
            { key: "reopened", header: t("accounting.periods.reopenedOn"), cell: (r) => r.reopened_at ? (
              <div><div>{f.dateTime(r.reopened_at)}</div><div className="text-xs text-ink-3">{r.reopen_reason}</div></div>
            ) : "—" },
            { key: "actions", header: t("accounting.common.actions"), align: "right", cell: (r) => !r.reopened_at && isAdmin ? <ReopenPeriodButton month={r.period_start.slice(0, 7)} /> : null },
          ]}
        />
      )}
    </div>
  );
}

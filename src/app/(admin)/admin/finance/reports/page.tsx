import { redirect } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader, StatCard } from "@/components/ui";
import { ExportLink, FinanceNav, RangeForm } from "@/components/finance/finance-nav";
import { FinTable, Signed, type FinCol } from "@/components/finance/fin-table";
import { BarChart } from "@/components/finance/charts";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { currenciesIn, loadFacts, todayKey } from "@/lib/finance/data";
import { buildFinancialReport, PROJECTION_DAYS, type LabeledProfit } from "@/lib/finance/report";
import { formatMonth, isCurrency, qs, rangeFrom } from "@/lib/finance/params";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("finance.reports.title") };
}

export default async function FinancialReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; currency?: string }> }) {
  const [me, { t, f, ctx }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const today = todayKey();
  const range = rangeFrom(sp, today);
  const res = await loadFacts(me.orgId, ctx.currency);
  if (res.error !== null) return <div className="animate-fade-up"><PageHeader title={t("finance.reports.title")} /><ErrorState message={res.error} /></div>;
  const currencies = currenciesIn(res.data, ctx.currency);
  const currency = isCurrency(sp.currency) && currencies.includes(sp.currency) ? sp.currency : ctx.currency;
  const rep = buildFinancialReport(res.data, range, currency, today);
  const money = (n: number) => f.money(n, currency);
  const pct = (m: number | null) => (m == null ? "—" : f.percent(m, 1));
  const exp = (kind: string) => `/admin/finance/export${qs({ kind, from: range.from, to: range.to, currency })}`;
  const unassigned = t("finance.reports.unassigned");

  const profitCols = (header: string): FinCol<LabeledProfit>[] => [
    { key: "label", header, cell: (r) => <span className={r.label ? "text-ink" : "text-ink-3"}>{r.label ?? unassigned}</span> },
    { key: "rev", header: t("finance.reports.revenue"), align: "right", cell: (r) => money(r.revenue) },
    { key: "exp", header: t("finance.reports.expenses"), align: "right", cell: (r) => money(r.expenses) },
    { key: "profit", header: t("finance.reports.profit"), align: "right", cell: (r) => <Signed value={r.profit} text={money(r.profit)} /> },
    { key: "margin", header: t("finance.reports.margin"), align: "right", cell: (r) => pct(r.margin) },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("finance.reports.title")} description={t("finance.reports.description", { from: f.date(range.from), to: f.date(range.to) })} />
      <FinanceNav t={t} active="reports" />
      <RangeForm t={t} action="/admin/finance/reports" from={range.from} to={range.to} currency={currency} currencies={currencies} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label={t("finance.reports.paymentsRecorded")} value={money(rep.recorded.amount)} hint={t("finance.payments.count", { count: rep.recorded.count })} />
        <StatCard label={t("finance.reports.reconciled")} value={money(rep.reconciled.amount)} tone="success" hint={t("finance.reports.refundsHint", { amount: money(rep.reconciled.refunded + rep.reconciled.reversed) })} />
        <StatCard label={t("finance.reports.expenses")} value={money(rep.expensesTotal)} tone="danger" hint={t("finance.reports.unpaidHint", { amount: money(rep.expensesUnpaid) })} />
        <StatCard label={t("finance.reports.profit")} value={money(rep.profit.profit)} tone={rep.profit.profit >= 0 ? "success" : "danger"} hint={t("finance.reports.marginHint", { margin: pct(rep.profit.margin) })} />
        <StatCard label={t("finance.reports.projected")} value={money(rep.projection.total)} accent hint={t("finance.reports.projectedHint", { days: PROJECTION_DAYS })} />
      </div>

      <Card>
        <CardHeader><div><CardTitle>{t("finance.reports.revenueVsExpenses")}</CardTitle><p className="mt-0.5 text-xs text-ink-3">{t("finance.reports.basisNote")}</p></div></CardHeader>
        <CardBody>
          <BarChart
            title={t("finance.reports.revenueVsExpenses")}
            labels={rep.byMonth.map((r) => formatMonth(f.locale, r.key!, "short"))}
            series={[
              { key: "revenue", label: t("finance.reports.revenue"), className: "fill-brand-accent", swatchClassName: "bg-brand-accent" },
              { key: "expenses", label: t("finance.reports.expenses"), className: "fill-brand-primary", swatchClassName: "bg-brand-primary" },
            ]}
            values={{ revenue: rep.byMonth.map((r) => r.revenue), expenses: rep.byMonth.map((r) => r.expenses) }}
            format={money}
          />
        </CardBody>
      </Card>

      <FinTable title={t("finance.reports.profitByMonth")} caption={t("finance.reports.profitByMonth")}
        actions={<ExportLink href={exp("report-month")} label={t("finance.exportCsv")} />}
        rows={rep.byMonth.map((r) => ({ ...r, label: formatMonth(f.locale, r.key!) }))} rowKey={(r) => String(r.key)} empty={t("finance.reports.empty")}
        cols={profitCols(t("finance.reports.month"))}
        footer={<tr><td className="px-5 py-2.5 font-medium text-ink">{t("finance.reports.total")}</td><td className="px-5 py-2.5 text-right tnum">{money(rep.profit.revenue)}</td><td className="px-5 py-2.5 text-right tnum">{money(rep.profit.expenses)}</td><td className="px-5 py-2.5 text-right"><Signed value={rep.profit.profit} text={money(rep.profit.profit)} /></td><td className="px-5 py-2.5 text-right tnum">{pct(rep.profit.margin)}</td></tr>}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <FinTable title={t("finance.reports.paymentsByMethod")} subtitle={t("finance.reports.paymentsByMethodHint")} caption={t("finance.reports.paymentsByMethod")}
          actions={<ExportLink href={exp("report-methods")} label={t("finance.exportCsv")} />}
          rows={rep.recorded.byMethod} rowKey={(r) => r.method} empty={t("finance.reports.empty")}
          cols={[
            { key: "m", header: t("finance.common.method"), cell: (r) => t.dynamic(`payments.methods.${r.method}`, undefined, r.method) },
            { key: "n", header: t("finance.reports.count"), align: "right", cell: (r) => f.number(r.count) },
            { key: "a", header: t("finance.common.amount"), align: "right", cell: (r) => money(r.amount) },
          ]}
        />
        <FinTable title={t("finance.reports.expensesByCategory")} caption={t("finance.reports.expensesByCategory")}
          actions={<ExportLink href={exp("report-categories")} label={t("finance.exportCsv")} />}
          rows={rep.categories} rowKey={(r) => r.categoryId ?? "none"} empty={t("finance.reports.empty")}
          cols={[
            { key: "c", header: t("finance.expenses.category"), cell: (r) => <span className={r.label ? "text-ink" : "text-ink-3"}>{r.label ?? t("finance.reports.uncategorised")}</span> },
            { key: "n", header: t("finance.reports.count"), align: "right", cell: (r) => f.number(r.count) },
            { key: "u", header: t("finance.expenses.unpaid"), align: "right", cell: (r) => money(r.unpaid) },
            { key: "a", header: t("finance.common.amount"), align: "right", cell: (r) => money(r.amount) },
            { key: "s", header: t("finance.reports.share"), align: "right", cell: (r) => f.percent(r.share, 1) },
          ]}
        />
      </div>

      <FinTable title={t("finance.reports.projected")} subtitle={t("finance.reports.projectedSubtitle", { until: f.date(rep.projectionUntil), overdue: money(rep.projection.overdue) })} caption={t("finance.reports.projected")}
        actions={<ExportLink href={exp("report-projection")} label={t("finance.exportCsv")} />}
        rows={rep.projection.rows} rowKey={(r) => r.month} empty={t("finance.reports.empty")}
        cols={[
          { key: "m", header: t("finance.reports.month"), cell: (r) => formatMonth(f.locale, r.month) },
          { key: "i", header: t("finance.reports.openInvoices"), align: "right", cell: (r) => money(r.invoices) },
          { key: "tr", header: t("finance.reports.upcomingTraining"), align: "right", cell: (r) => money(r.training) },
          { key: "c", header: t("finance.reports.upcomingCamps"), align: "right", cell: (r) => money(r.camps) },
          { key: "t", header: t("finance.reports.total"), align: "right", cell: (r) => <span className="text-ink">{money(r.total)}</span> },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <FinTable title={t("finance.reports.profitByProgram")} caption={t("finance.reports.profitByProgram")} actions={<ExportLink href={exp("report-program")} label={t("finance.exportCsv")} />}
          rows={rep.byProgram} rowKey={(r) => r.key ?? "none"} empty={t("finance.reports.empty")} cols={profitCols(t("finance.expenses.program"))} />
        <FinTable title={t("finance.reports.profitByCamp")} caption={t("finance.reports.profitByCamp")} actions={<ExportLink href={exp("report-camp")} label={t("finance.exportCsv")} />}
          rows={rep.byCamp} rowKey={(r) => r.key ?? "none"} empty={t("finance.reports.empty")} cols={profitCols(t("finance.expenses.camp"))} />
      </div>
      <FinTable title={t("finance.reports.profitByLocation")} caption={t("finance.reports.profitByLocation")} actions={<ExportLink href={exp("report-location")} label={t("finance.exportCsv")} />}
        rows={rep.byLocation} rowKey={(r) => r.key ?? "none"} empty={t("finance.reports.empty")} cols={profitCols(t("finance.expenses.location"))} />
    </div>
  );
}

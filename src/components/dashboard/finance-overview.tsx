import Link from "next/link";
import { Banknote, GraduationCap, UserCheck, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, ErrorState, Skeleton, StatCard } from "@/components/ui";
import { BarChart, HBarChart, LineChart } from "@/components/finance/charts";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { balancesFromFacts, loadFacts, loadStudents, registrationsByProgramCount, todayKey } from "@/lib/finance/data";
import { monthBounds, monthsBetween, profitBy, reconciledEarnings, studentTrend, sumMoney } from "@/lib/finance/math";
import { formatMonth, last12Months } from "@/lib/finance/params";

/** Spec "administrative dashboard": student / money KPI tiles and three charts (theme tokens only). */
export async function FinanceOverview() {
  const [me, { t, f, ctx }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) return null;
  const today = todayKey();
  const year = last12Months(today);
  const [facts, students, regs] = await Promise.all([
    loadFacts(me.orgId, ctx.currency),
    loadStudents(me.orgId).catch(() => null),
    registrationsByProgramCount(me.orgId, year).catch(() => null),
  ]);
  if (facts.error !== null || !students || !regs) return <ErrorState title={t("finance.dashboard.error")} message={facts.error ?? ""} />;

  const cur = ctx.currency;
  const months = monthsBetween(year);
  const month = monthBounds(today);
  const revenue = reconciledEarnings(facts.data.payments, { from: month.from, to: today }, cur).amount;
  const outstanding = sumMoney(balancesFromFacts(facts.data).filter((b) => b.currency === cur).map((b) => b.outstanding), cur);
  const onBooks = students.filter((s) => s.status !== "archived");
  const active = onBooks.filter((s) => s.status === "active").length;
  const byMonth = profitBy("month", { payments: facts.data.payments, invoices: facts.data.invoices, expenses: facts.data.expenses }, year, cur);
  const trend = studentTrend(students, months);
  const programName = new Map(facts.data.refs.programs.map((p) => [p.id, p.name]));
  const short = months.map((m) => formatMonth(f.locale, m, "short"));
  const money = (n: number) => f.money(n, cur);
  const count = (n: number) => f.number(n);

  return (
    <section aria-labelledby="fin-overview" className="space-y-6">
      <h2 id="fin-overview" className="sr-only">{t("finance.dashboard.title")}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("finance.dashboard.totalStudents")} value={count(onBooks.length)} icon={<GraduationCap className="h-5 w-5" />} href="/admin/athletes" />
        <StatCard label={t("finance.dashboard.activeStudents")} value={count(active)} icon={<UserCheck className="h-5 w-5" />} href="/admin/athletes" tone="success" />
        <StatCard label={t("finance.dashboard.revenue")} value={money(revenue)} hint={formatMonth(f.locale, month.from.slice(0, 7))} icon={<Banknote className="h-5 w-5" />} href="/admin/finance/reports" accent />
        <StatCard label={t("finance.dashboard.outstanding")} value={money(outstanding)} icon={<Wallet className="h-5 w-5" />} href="/admin/finance?tab=balances" tone={outstanding > 0 ? "warning" : "brand"} />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("finance.dashboard.financialChart")}</CardTitle>
            <Link href="/admin/finance/reports" className="text-xs text-ink-2 hover:text-ink">{t("finance.dashboard.openReports")}</Link>
          </CardHeader>
          <CardBody>
            <BarChart
              title={t("finance.dashboard.financialChart")} labels={short} format={money}
              series={[
                { key: "revenue", label: t("finance.reports.revenue"), className: "fill-brand-accent", swatchClassName: "bg-brand-accent" },
                { key: "expenses", label: t("finance.reports.expenses"), className: "fill-brand-primary", swatchClassName: "bg-brand-primary" },
              ]}
              values={{ revenue: byMonth.map((r) => r.revenue), expenses: byMonth.map((r) => r.expenses) }}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("finance.dashboard.studentChart")}</CardTitle></CardHeader>
          <CardBody>
            <LineChart
              title={t("finance.dashboard.studentChart")} labels={short} format={count}
              series={[
                { key: "total", label: t("finance.dashboard.totalStudents"), className: "stroke-brand-accent", swatchClassName: "bg-brand-accent" },
                { key: "active", label: t("finance.dashboard.activeStudents"), className: "stroke-brand-primary", swatchClassName: "bg-brand-primary" },
              ]}
              values={{ total: trend.map((x) => x.total), active: trend.map((x) => x.active) }}
            />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader><div><CardTitle>{t("finance.dashboard.registrationsChart")}</CardTitle><p className="mt-0.5 text-xs text-ink-3">{t("finance.dashboard.last12Months")}</p></div></CardHeader>
        <CardBody>
          {regs.length === 0
            ? <p className="text-sm text-ink-3">{t("finance.dashboard.noRegistrations")}</p>
            : <HBarChart title={t("finance.dashboard.registrationsChart")} format={count}
                rows={regs.slice(0, 8).map((r) => ({ label: programName.get(r.programId) ?? "—", value: r.count }))} />}
        </CardBody>
      </Card>
    </section>
  );
}

export function FinanceOverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface p-5"><Skeleton className="h-3 w-20" /><Skeleton className="mt-4 h-8 w-16" /></div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>
    </div>
  );
}

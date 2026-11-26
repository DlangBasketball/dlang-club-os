import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, ErrorState, Input, Label, PageHeader, StatCard } from "@/components/ui";
import { ExportLink, FinanceNav } from "@/components/finance/finance-nav";
import { FinTable } from "@/components/finance/fin-table";
import { PayoutButtons, RateEditor } from "@/components/finance/payout-actions";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { DEFAULT_SESSION_MINUTES, payoutReport, todayKey } from "@/lib/finance/data";
import { sumMoney } from "@/lib/finance/math";
import { formatMonth, isMonth } from "@/lib/finance/params";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("finance.payouts.title") };
}

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const [me, { t, f, ctx }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const today = todayKey();
  const month = isMonth(sp.month) && sp.month <= today.slice(0, 7) ? sp.month : today.slice(0, 7);
  const res = await payoutReport(me.orgId, month);
  const monthLabel = formatMonth(f.locale, month);
  const hours = (min: number) => f.number(min / 60, { maximumFractionDigits: 2 });

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("finance.payouts.title")} description={t("finance.payouts.description", { minutes: DEFAULT_SESSION_MINUTES })} />
      <FinanceNav t={t} active="payouts" />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor="pay-month">{t("finance.payouts.month")}</Label><Input id="pay-month" name="month" type="month" defaultValue={month} max={today.slice(0, 7)} className="w-44" /></div>
        <Button type="submit" size="sm" variant="secondary" className="h-10">{t("finance.filters.apply")}</Button>
      </form>
      {res.error !== null ? <ErrorState message={res.error} /> : (() => {
        const rows = res.data;
        const cur = ctx.currency;
        const due = sumMoney(rows.filter((r) => !r.payout && r.calc && r.rate?.currency === cur).map((r) => r.calc!.amount), cur);
        const paid = sumMoney(rows.filter((r) => r.payout && r.payout.currency === cur).map((r) => r.payout!.amount), cur);
        return (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label={t("finance.payouts.toPay")} value={f.money(due, cur)} hint={monthLabel} tone={due > 0 ? "warning" : "brand"} />
              <StatCard label={t("finance.payouts.paidTotal")} value={f.money(paid, cur)} tone="success" />
              <StatCard label={t("finance.payouts.coachesWithoutRate")} value={f.number(rows.filter((r) => !r.rate).length)} />
            </div>
            <FinTable
              title={t("finance.payouts.tableTitle", { month: monthLabel })} subtitle={t("finance.payouts.tableSubtitle")} caption={t("finance.payouts.title")}
              actions={<ExportLink href={`/admin/finance/export?kind=payouts&month=${month}`} label={t("finance.exportCsv")} />}
              rows={rows} rowKey={(r) => r.coachId} empty={t("finance.payouts.empty")}
              cols={[
                { key: "coach", header: t("finance.expenses.coach"), cell: (r) => <Link href={`/admin/coaches/${r.coachId}`} className="text-ink hover:text-maroon">{r.coachName}</Link> },
                { key: "rate", header: t("finance.payouts.rate"), cell: (r) => <RateEditor coachId={r.coachId} coachName={r.coachName} rate={r.rate} /> },
                { key: "sessions", header: t("finance.payouts.sessions"), align: "right", cell: (r) => f.number(r.activity.sessions) },
                { key: "bookings", header: t("finance.payouts.bookings"), align: "right", cell: (r) => f.number(r.activity.bookings) },
                { key: "hours", header: t("finance.payouts.hours"), align: "right", cell: (r) => (
                  <span>{hours(r.calc?.minutes ?? r.activity.sessionMinutes + r.activity.bookingMinutes)}{r.calc?.basis === "clock" && <Badge tone="info" className="ml-1.5">{t("finance.payouts.clocked")}</Badge>}</span>
                ) },
                { key: "amount", header: t("finance.common.amount"), align: "right", cell: (r) => r.payout ? f.money(r.payout.amount, r.payout.currency) : r.calc ? f.money(r.calc.amount, r.rate!.currency) : "—" },
                { key: "status", header: t("finance.common.status"), cell: (r) => r.payout
                  ? <Badge tone="success">{t("finance.payouts.paidOn", { date: f.date(r.payout.paidOn) })}</Badge>
                  : <Badge tone={r.calc && r.calc.amount > 0 ? "warning" : "neutral"}>{t("finance.payouts.open")}</Badge> },
                { key: "actions", header: t("finance.common.actions"), align: "right", cell: (r) => (
                  <PayoutButtons coachId={r.coachId} coachName={r.coachName} month={month} today={today}
                    amountLabel={r.calc ? f.money(r.calc.amount, r.rate!.currency) : ""} payoutId={r.payout?.id ?? null}
                    canPay={!!r.calc && r.calc.amount > 0} />
                ) },
              ]}
            />
          </>
        );
      })()}
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Label, PageHeader, Select, StatCard } from "@/components/ui";
import { FinTable } from "@/components/finance/fin-table";
import { getI18n } from "@/lib/i18n/server";
import { formatMonth } from "@/lib/finance/params";
import { zonedDayKey } from "@/lib/staff/hours";
import {
  getMembershipMonthReport, listReportSeasons, listSeasonTeams, requireFinanceUser,
} from "@/lib/finance-reports/data";
import {
  MEMBERSHIP_REPORT_STATUSES, membershipReportQuery, membershipTotals, resolveMembershipFilters, seasonMonths, statusCounts,
  type MembershipReportRow, type MembershipReportStatus, type MembershipTotals,
} from "@/lib/finance-reports/membership-report";
import { reportErrorKey } from "@/lib/finance-reports/errors";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("financeReports.membership.title") };
}

const STATUS_TONE: Record<MembershipReportStatus, "success" | "warning" | "danger" | "neutral" | "info" | "accent"> = {
  paid: "success", partially_paid: "warning", unpaid: "danger", no_installment: "neutral", overdue: "danger", sponsored: "accent",
};

type SP = Record<string, string | string[] | undefined>;

/**
 * Finance → Club membership payments: every season-fee membership of a club
 * season for one month (public.club_membership_month_report). Admin / finance
 * only; the Excel download uses the same function and the same filters.
 */
export default async function ClubMembershipPaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [me, { t, f }, sp] = await Promise.all([requireFinanceUser(), getI18n(), searchParams]);
  if (!me) redirect("/admin/dashboard");
  const title = t("financeReports.membership.title");
  const seasonsRes = await listReportSeasons(me.orgId);
  if (seasonsRes.error !== null) {
    return <div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("financeReports.common.loadError")} message={seasonsRes.error} /></div>;
  }
  const seasons = seasonsRes.data;
  const today = zonedDayKey(new Date(), f.timeZone);
  const filters = resolveMembershipFilters(sp, seasons, today.slice(0, 7));
  const season = seasons.find((s) => s.id === filters.seasonId);
  if (!season || !filters.month) {
    return (
      <div className="animate-fade-up">
        <PageHeader title={title} description={t("financeReports.membership.description")} />
        <EmptyState title={t("financeReports.common.noSeasons")} />
      </div>
    );
  }
  const months = seasonMonths(season.startsOn, season.endsOn);
  const [teamsRes, reportRes] = await Promise.all([listSeasonTeams(me.orgId, season.id), getMembershipMonthReport(filters)]);
  const exportHref = `/admin/finance/club-membership-payments/export?${membershipReportQuery(filters)}`;

  const statusLabel = (s: MembershipReportStatus) => t.dynamic(`financeReports.membership.statuses.${s}`);
  const money = (n: number, c: string) => f.money(n, c);
  const rows = reportRes.data ?? [];
  const totals = membershipTotals(rows);
  const counts = statusCounts(rows);

  const cols = [
    { key: "player", header: t("financeReports.membership.cols.player"), cell: (r: MembershipReportRow) => (
      <Link href={`/admin/athletes/${r.athleteId}`} className="font-medium text-ink hover:text-maroon">{r.athleteName}</Link>
    ) },
    { key: "teams", header: t("financeReports.membership.cols.teams"), cell: (r: MembershipReportRow) => r.teamNames ?? "—" },
    { key: "payers", header: t("financeReports.membership.cols.payers"), cell: (r: MembershipReportRow) => <span className="line-clamp-2">{r.payerNames ?? "—"}</span> },
    { key: "fee", header: t("financeReports.membership.cols.agreedFee"), align: "right" as const, cell: (r: MembershipReportRow) => money(r.agreedFee, r.currency) },
    { key: "due", header: t("financeReports.membership.cols.dueInMonth"), align: "right" as const, cell: (r: MembershipReportRow) => money(r.dueInMonth, r.currency) },
    { key: "received", header: t("financeReports.membership.cols.receivedInMonth"), align: "right" as const, cell: (r: MembershipReportRow) => money(r.receivedInMonth, r.currency) },
    { key: "applied", header: t("financeReports.membership.cols.appliedToMonth"), align: "right" as const, cell: (r: MembershipReportRow) => money(r.appliedToMonth, r.currency) },
    { key: "open", header: t("financeReports.membership.cols.openForMonth"), align: "right" as const, cell: (r: MembershipReportRow) => (
      <span className={r.openForMonth > 0 ? "text-warning" : "text-ink-3"}>{money(r.openForMonth, r.currency)}</span>
    ) },
    { key: "overdue", header: t("financeReports.membership.cols.overdueAmount"), align: "right" as const, cell: (r: MembershipReportRow) => (
      <span className={r.overdueAmount > 0 ? "text-danger" : "text-ink-3"}>{money(r.overdueAmount, r.currency)}</span>
    ) },
    { key: "balance", header: t("financeReports.membership.cols.seasonBalance"), align: "right" as const, cell: (r: MembershipReportRow) => money(r.seasonBalance, r.currency) },
    { key: "cf", header: t("financeReports.membership.cols.carryForwardOpen"), align: "right" as const, cell: (r: MembershipReportRow) => (
      r.carryForwardDue > 0 ? money(r.carryForwardOpen, r.currency) : <span className="text-ink-3">—</span>
    ) },
    { key: "status", header: t("financeReports.membership.cols.status"), cell: (r: MembershipReportRow) => <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge> },
  ];

  const totalRow = (tot: MembershipTotals) => (
    <tr key={tot.currency} className="font-medium text-ink">
      <td className="px-5 py-2.5" colSpan={3}>
        {t("financeReports.common.total", { currency: tot.currency })} · {t("financeReports.common.members", { count: tot.members })}
      </td>
      {[tot.agreedFee, tot.dueInMonth, tot.receivedInMonth, tot.appliedToMonth, tot.openForMonth, tot.overdueAmount, tot.seasonBalance, tot.carryForwardOpen].map((v, i) => (
        <td key={i} className="whitespace-nowrap px-5 py-2.5 text-right tnum">{money(v, tot.currency)}</td>
      ))}
      <td />
    </tr>
  );

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={title}
        description={t("financeReports.membership.description")}
        actions={
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href={exportHref}><Button variant="secondary"><Download className="h-4 w-4" aria-hidden /> {t("financeReports.common.downloadXlsx")}</Button></a>
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="cm-season">{t("financeReports.common.season")}</Label>
          <Select id="cm-season" name="season" defaultValue={season.id} className="w-52">
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="cm-month">{t("financeReports.common.month")}</Label>
          <Select id="cm-month" name="month" defaultValue={filters.month} className="w-44">
            {months.map((m) => <option key={m} value={m}>{formatMonth(f.locale, m)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="cm-team">{t("financeReports.common.team")}</Label>
          <Select id="cm-team" name="team" defaultValue={filters.teamId ?? ""} className="w-52">
            <option value="">{t("financeReports.common.allTeams")}</option>
            {(teamsRes.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="cm-status">{t("financeReports.common.status")}</Label>
          <Select id="cm-status" name="status" defaultValue={filters.status ?? ""} className="w-52">
            <option value="">{t("financeReports.common.allStatuses")}</option>
            {MEMBERSHIP_REPORT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </Select>
        </div>
        <Button type="submit" variant="secondary">{t("financeReports.common.apply")}</Button>
      </form>

      {reportRes.error !== null ? (
        <ErrorState title={t("financeReports.common.loadError")} message={t.dynamic(reportErrorKey(reportRes.error))} />
      ) : (
        <>
          {totals.map((tot) => (
            <div key={tot.currency} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label={t("financeReports.membership.cols.dueInMonth")} value={money(tot.dueInMonth, tot.currency)}
                hint={t("financeReports.common.members", { count: tot.members })} />
              <StatCard label={t("financeReports.membership.cols.receivedInMonth")} value={money(tot.receivedInMonth, tot.currency)} tone="success" />
              <StatCard label={t("financeReports.membership.cols.openForMonth")} value={money(tot.openForMonth, tot.currency)} tone={tot.openForMonth > 0 ? "warning" : "brand"} />
              <StatCard label={t("financeReports.membership.cols.overdueAmount")} value={money(tot.overdueAmount, tot.currency)}
                tone={tot.overdueAmount > 0 ? "danger" : "brand"} hint={`${t("financeReports.membership.membersOverdue")}: ${f.number(counts.overdue)}`} />
            </div>
          ))}
          <FinTable
            title={`${season.name} · ${formatMonth(f.locale, filters.month)}`}
            subtitle={t("financeReports.membership.rulesHint")}
            caption={title}
            rows={rows}
            rowKey={(r) => r.membershipId}
            empty={t("financeReports.membership.empty")}
            cols={cols}
            footer={totals.length ? <>{totals.map(totalRow)}</> : undefined}
          />
          <p className="text-xs text-ink-3">{t("financeReports.membership.carryForwardHint")}</p>
        </>
      )}
    </div>
  );
}

import { NextResponse } from "next/server";
import { hasFeature } from "@/lib/upgrades/server";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";
import { formatMonth } from "@/lib/finance/params";
import { zonedDayKey } from "@/lib/staff/hours";
import { getMembershipMonthReport, getSeasonOverview, listReportSeasons, requireFinanceUser } from "@/lib/finance-reports/data";
import { fileSlug, resolveMembershipFilters, seasonMonths, MEMBERSHIP_REPORT_STATUSES } from "@/lib/finance-reports/membership-report";
import { buildMembershipWorkbook, MONTHLY_COLUMNS, type MembershipWorkbookLabels } from "@/lib/finance-reports/membership-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /admin/finance/club-membership-payments/export?season=&month=&team=&status=
 * Excel workbook ("Monthly Report" + "Season Overview") with the same filters
 * and the same SQL functions as the page. Admin / finance of the session's
 * club only; the download is audit-logged (counts only).
 */
export async function GET(request: Request) {
  const me = await requireFinanceUser();
  if (!me || !(await tenantMatchesOrg(me.orgId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await hasFeature(me.orgId, "finance"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { t, f } = await getI18n();
  const url = new URL(request.url);
  const seasons = await listReportSeasons(me.orgId);
  if (seasons.error !== null) return NextResponse.json({ error: seasons.error }, { status: 500 });
  const today = zonedDayKey(new Date(), f.timeZone);
  const filters = resolveMembershipFilters(Object.fromEntries(url.searchParams.entries()), seasons.data, today.slice(0, 7));
  const season = seasons.data.find((s) => s.id === filters.seasonId);
  if (!season || !filters.month) return NextResponse.json({ error: "SEASON_NOT_FOUND" }, { status: 404 });

  const [report, overview] = await Promise.all([getMembershipMonthReport(filters), getSeasonOverview(season.id, filters.teamId)]);
  if (report.error !== null) return NextResponse.json({ error: report.error }, { status: 400 });
  if (overview.error !== null) return NextResponse.json({ error: overview.error }, { status: 400 });

  const monthName = formatMonth(f.locale, filters.month);
  const labels: MembershipWorkbookLabels = {
    monthlySheet: t("financeReports.membership.sheetMonthly"),
    overviewSheet: t("financeReports.membership.sheetOverview"),
    title: t("financeReports.membership.xlsxTitle", { season: season.name, month: monthName }),
    columns: Object.fromEntries(MONTHLY_COLUMNS.map((c) => [c, t.dynamic(`financeReports.membership.cols.${c}`)])) as MembershipWorkbookLabels["columns"],
    status: Object.fromEntries(MEMBERSHIP_REPORT_STATUSES.map((s) => [s, t.dynamic(`financeReports.membership.statuses.${s}`)])) as MembershipWorkbookLabels["status"],
    total: (currency) => t("financeReports.common.total", { currency }),
    monthLabel: (m) => formatMonth(f.locale, m, "short"),
    expected: t("financeReports.membership.expected"),
    received: t("financeReports.membership.received"),
    totalPaid: t("financeReports.membership.totalPaid"),
    remainingBalance: t("financeReports.membership.remainingBalance"),
    noInstallmentMark: "—",
    legendNoInstallment: t("financeReports.membership.legendNoInstallment"),
    legendMissed: t("financeReports.membership.legendMissed"),
  };
  const wb = buildMembershipWorkbook({
    labels, rows: report.data, overview: overview.data, months: seasonMonths(season.startsOn, season.endsOn), today,
  });
  const buf = await wb.xlsx.writeBuffer();
  await writeAudit(me, "finance.export.club_membership_payments", "memberships", null, {
    season_id: season.id, month: filters.month, team_id: filters.teamId, status: filters.status, rows: report.data.length,
  });
  const name = `club-membership-payments_${fileSlug(season.name)}_${filters.month}.xlsx`;
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

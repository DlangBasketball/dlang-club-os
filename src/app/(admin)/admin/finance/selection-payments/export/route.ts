import { NextResponse } from "next/server";
import { hasFeature } from "@/lib/upgrades/server";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { getSelectionPayments, requireFinanceUser } from "@/lib/finance-reports/data";
import { fileSlug } from "@/lib/finance-reports/membership-report";
import {
  buildSelectionWorkbook, filterSelectionRows, resolveSelectionFilters, SELECTION_COLUMNS, type SelectionLabels,
} from "@/lib/finance-reports/selection-report";
import { selectionPlanLabel } from "@/lib/finance-reports/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /admin/finance/selection-payments/export?program=&division=&tournament=&status=
 * Excel list of the selection enrolments with the page's filters (programme
 * and tournament columns included). Admin / finance only; audit-logged.
 */
export async function GET(request: Request) {
  const me = await requireFinanceUser();
  if (!me || !(await tenantMatchesOrg(me.orgId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await hasFeature(me.orgId, "finance"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { t, f } = await getI18n();
  const q = Object.fromEntries(new URL(request.url).searchParams.entries());
  const res0 = await getSelectionPayments(me.orgId, q.program ?? null);
  if (res0.error !== null) return NextResponse.json({ error: res0.error }, { status: 500 });
  const filters = resolveSelectionFilters(q, res0.data.programs.map((p) => p.id));
  const res = filters.programId === (q.program ?? null) ? res0 : await getSelectionPayments(me.orgId, filters.programId);
  if (res.error !== null) return NextResponse.json({ error: res.error }, { status: 500 });
  const program = res.data.programs.find((p) => p.id === filters.programId);
  if (!program) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rows = filterSelectionRows(res.data.rows, filters);
  const today = zonedDayKey(new Date(), f.timeZone);
  const money = (n: number, c: string) => f.money(n, c);
  const labels: SelectionLabels = {
    sheet: t("financeReports.selection.sheet"),
    title: t("financeReports.selection.xlsxTitle", { program: program.name, date: f.date(today) }),
    columns: Object.fromEntries(SELECTION_COLUMNS.map((c) => [c, t.dynamic(`financeReports.selection.cols.${c}`)])) as SelectionLabels["columns"],
    plan: (r) => selectionPlanLabel(r, t, money),
    enrolment: (s) => t.dynamic(`financeReports.selection.enrolments.${s}`, undefined, s),
    status: (s) => t.dynamic(`financeReports.selection.statuses.${s}`),
    total: (currency) => t("financeReports.common.total", { currency }),
  };
  const buf = await buildSelectionWorkbook(rows, labels).xlsx.writeBuffer();
  await writeAudit(me, "finance.export.selection_payments", "program_applications", null, {
    program_id: program.id, division_id: filters.divisionId, tournament_id: filters.tournamentId, status: filters.status, rows: rows.length,
  });
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="selection-payments_${fileSlug(program.name)}_${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasFeature } from "@/lib/upgrades/server";
import { getTranslations } from "@/lib/i18n/server";
import { toCsv } from "@/lib/sportsops/csv";
import { getSelectionReport } from "@/lib/selection/data";
import { parseReportFilters } from "@/lib/selection/report";

/**
 * GET /admin/selection/report/export?program=&season=&division=&package=
 * Finance report of selection programmes as CSV. Admin / finance only; the
 * SQL report is scoped to the caller's club (selection_report).
 */
export async function GET(request: Request) {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await hasFeature(me.orgId, "selection_programs"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const filters = parseReportFilters(Object.fromEntries(url.searchParams.entries()));
  const [report, t] = await Promise.all([getSelectionReport(filters), getTranslations()]);
  if (report.error) return NextResponse.json({ error: report.error }, { status: 500 });
  const c = (k: string) => t.dynamic(`selection.report.csv.${k}`, undefined, k);
  const csv = toCsv(
    ["program", "season", "division", "package", "player", "birthYear", "family", "member", "currentClub", "status", "currency",
      "invoice", "invoiced", "sponsored", "collected", "outstanding", "instalments", "applied", "accepted", "enrolled"].map(c),
    report.data.map((r) => [
      r.programName, r.seasonYear, r.divisionName, r.packageName, r.athleteName, r.birthYear, r.familyName, r.isMember ? 1 : 0,
      r.currentClub, t.dynamic(`selection.statuses.${r.status}`, undefined, r.status), r.currency, r.invoiceNumber,
      r.invoiced.toFixed(2), r.sponsored.toFixed(2), r.collected.toFixed(2), r.outstanding.toFixed(2), r.installmentCount,
      r.appliedAt.slice(0, 10), r.acceptedAt?.slice(0, 10) ?? "", r.enrolledAt?.slice(0, 10) ?? "",
    ]),
  );
  const filename = `selection-report_${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

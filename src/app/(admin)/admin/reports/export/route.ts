import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { toCsv } from "@/lib/sportsops/csv";
import { attendanceReport, defaultRange, outstandingReceivables, registrationsByProgram, revenueByProgram } from "@/lib/sportsops/reports";
import { isDayKey } from "@/lib/sportsops/time";

/**
 * GET /admin/reports/export?type=attendance-teams|attendance-athletes|revenue|receivables|registrations&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Admin/finance only; RLS scopes all data to the caller's organization.
 */
export async function GET(request: Request) {
  const me = await getSessionUser();
  if (!me || !(me.roles.includes("admin") || me.roles.includes("finance"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const def = await defaultRange();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const range = { from: isDayKey(from) ? from : def.from, to: isDayKey(to) ? to : def.to };
  const suffix = `${range.from}_${range.to}`;

  let filename = "";
  let csv = "";
  const fail = (e: string) => NextResponse.json({ error: e }, { status: 500 });

  switch (type) {
    case "attendance-teams":
    case "attendance-athletes": {
      const r = await attendanceReport(range);
      if (r.error !== null) return fail(r.error);
      if (type === "attendance-teams") {
        filename = `attendance-by-team_${suffix}.csv`;
        csv = toCsv(["Team / program", "Sessions", "Marks", "Present", "Late", "Absent", "Excused", "Rate %"],
          r.data.byTeam.map((x) => [x.group, x.sessions, x.marks, x.present, x.late, x.absent, x.excused, x.rate]));
      } else {
        filename = `attendance-by-athlete_${suffix}.csv`;
        csv = toCsv(["Athlete", "Teams", "Marks", "Present", "Late", "Absent", "Excused", "Rate %"],
          r.data.byAthlete.map((x) => [x.name, x.teams, x.marks, x.present, x.late, x.absent, x.excused, x.rate]));
      }
      break;
    }
    case "revenue": {
      const r = await revenueByProgram(range);
      if (r.error !== null) return fail(r.error);
      filename = `revenue-by-program_${suffix}.csv`;
      csv = toCsv(["Program", "Invoices", "Invoiced", "Collected", "Outstanding"],
        r.data.map((x) => [x.program, x.invoices, x.invoiced.toFixed(2), x.collected.toFixed(2), x.outstanding.toFixed(2)]));
      break;
    }
    case "receivables": {
      const r = await outstandingReceivables();
      if (r.error !== null) return fail(r.error);
      filename = `outstanding-receivables_${new Date().toISOString().slice(0, 10)}.csv`;
      csv = toCsv(["Invoice", "Family", "Program", "Status", "Due date", "Days overdue", "Aging", "Total", "Paid", "Balance"],
        r.data.map((x) => [x.number, x.family, x.program, x.status, x.dueDate, x.daysOverdue, x.bucket, x.total.toFixed(2), x.paid.toFixed(2), x.balance.toFixed(2)]));
      break;
    }
    case "registrations": {
      const r = await registrationsByProgram(range);
      if (r.error !== null) return fail(r.error);
      filename = `registrations-by-program_${suffix}.csv`;
      csv = toCsv(["Program", "Capacity", "Confirmed", "Completed", "Pending", "Waitlist", "Cancelled", "Total", "Fill %"],
        r.data.map((x) => [x.program, x.capacity, x.confirmed, x.completed, x.pending, x.waitlist, x.cancelled, x.total, x.fill]));
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
  }

  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

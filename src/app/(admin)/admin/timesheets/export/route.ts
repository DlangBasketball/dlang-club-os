import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";
import { getStaffHours, listEmployees } from "@/lib/staff/data";
import { minutesToHours, toCsv } from "@/lib/staff/hours";

export const dynamic = "force-dynamic";

/**
 * GET /admin/timesheets/export?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Planned vs worked hours per employee as CSV (admin / finance). Built from
 * public.staff_hours(), which re-checks the caller's role in the database.
 */
export async function GET(req: Request) {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !me.roles.some((r) => r === "admin" || r === "finance")) {
    return new NextResponse(t("staff.errors.forbidden"), { status: 403 });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from) || !day.test(to) || to < from) return new NextResponse(t("staff.errors.invalid"), { status: 400 });

  const [hours, employees] = await Promise.all([getStaffHours(me.orgId, from, to), me.roles.includes("admin") ? listEmployees(me.orgId) : Promise.resolve({ data: null, error: null })]);
  if (hours.error !== null) return new NextResponse(t("staff.errors.generic"), { status: 400 });
  const email = new Map((employees.data ?? []).map((e) => [e.profileId, e.email]));
  const yes = t("staff.timesheets.csv.yes");
  const no = t("staff.timesheets.csv.no");

  const rows: (string | number | null)[][] = [[
    t("staff.timesheets.csv.employee"), t("staff.timesheets.csv.email"), t("staff.timesheets.csv.from"), t("staff.timesheets.csv.to"),
    t("staff.timesheets.csv.plannedHours"), t("staff.timesheets.csv.workedHours"), t("staff.timesheets.csv.breakHours"),
    t("staff.timesheets.csv.differenceHours"), t("staff.timesheets.csv.shifts"), t("staff.timesheets.csv.openShifts"),
    t("staff.timesheets.csv.missedShifts"), t("staff.timesheets.csv.approved"),
  ]];
  for (const r of hours.data) {
    rows.push([
      r.full_name, email.get(r.profile_id) ?? null, from, to,
      minutesToHours(r.planned_minutes), minutesToHours(r.worked_minutes), minutesToHours(r.break_minutes),
      minutesToHours(r.worked_minutes - r.planned_minutes), r.entry_count, r.open_entries, r.missed_entries, r.approved ? yes : no,
    ]);
  }
  await writeAudit({ id: me.id, orgId: me.orgId }, "staff.timesheets.export", "staff_time_entries", null, { from, to, rows: hours.data.length });
  return new NextResponse("﻿" + toCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="timesheets-${from}-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

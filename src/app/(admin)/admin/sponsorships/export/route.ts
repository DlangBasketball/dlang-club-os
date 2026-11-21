import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";
import { toCsv } from "@/lib/sportsops/csv";
import { getSponsorshipReport } from "@/lib/data/sponsorships";
import { parseSeasonParam, seasonFor } from "@/lib/people/sponsorship";

/**
 * GET /admin/sponsorships/export?season=2026-27
 * Sponsorship ledger of the season as CSV (one row per fee sponsored, then a
 * total row per currency). Admin / finance only; RLS scopes rows to the
 * caller's club. Headers are translated; amounts are plain decimals.
 */
export async function GET(request: Request) {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance")) || !(await tenantMatchesOrg(me.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { t } = await getI18n();
  const url = new URL(request.url);
  const season = parseSeasonParam(url.searchParams.get("season") ?? undefined) ?? seasonFor(new Date().toISOString().slice(0, 10));
  const res = await getSponsorshipReport(season);
  if (res.error !== null) return NextResponse.json({ error: res.error }, { status: 500 });
  const club = t("sponsorship.sponsorClub");
  const headers = [
    t("sponsorship.report.date"), t("sponsorship.report.player"), t("sponsorship.report.sponsor"), t("sponsorship.report.fee"),
    t("sponsorship.report.method"), t("sponsorship.report.invoice"), t("sponsorship.percent"), t("sponsorship.report.amount"), t("sponsorship.report.currency"),
  ];
  const rows = res.data.entries.map((e) => [
    e.date, e.playerName, e.sponsorName ?? club, t.dynamic(`sponsorship.scopes.${e.scope}`, undefined, e.scope),
    t.dynamic(`sponsorship.report.methods.${e.method}`, undefined, e.method), e.invoiceNumber ?? "", e.percent, String(e.amount), e.currency,
  ]);
  for (const total of res.data.summary.totals) {
    rows.push(["", t("sponsorship.report.total"), "", "", "", "", "", String(total.amount), total.currency]);
  }
  await writeAudit(me as { id: string; orgId: string }, "sponsorship.report.export", "athlete_sponsorship_entries", null, { season: season.label, rows: res.data.entries.length });
  return new NextResponse("﻿" + toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sponsorships_${season.label}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

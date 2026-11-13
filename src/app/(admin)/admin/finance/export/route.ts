import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";
import { toCsv, type CsvCell } from "@/lib/sportsops/csv";
import {
  balancesFromFacts, currenciesIn, ledgerFromFacts, listExpenses, loadFacts, payoutReport, todayKey, LEDGER_TYPES, type LedgerType,
} from "@/lib/finance/data";
import { buildFinancialReport, type LabeledProfit } from "@/lib/finance/report";
import { isCurrency, isMonth, isUuid, rangeFrom } from "@/lib/finance/params";

/**
 * GET /admin/finance/export?kind=…&from=YYYY-MM-DD&to=YYYY-MM-DD&currency=XXX
 * kinds: balances | ledger | expenses | payouts | report-month | report-program |
 *        report-camp | report-location | report-methods | report-categories | report-projection
 * Admin / finance only; data scoped to the session's org (RLS + explicit org filter).
 * Headers are translated; amounts are plain decimals (machine-readable).
 */
export async function GET(request: Request) {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance")) || !(await tenantMatchesOrg(me.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { t, ctx } = await getI18n();
  const url = new URL(request.url);
  const p = (k: string) => url.searchParams.get(k);
  const kind = p("kind") ?? "";
  const today = todayKey();
  const range = rangeFrom({ from: p("from"), to: p("to") }, today);
  const suffix = `${range.from}_${range.to}`;
  const fail = (e: string) => NextResponse.json({ error: e }, { status: 500 });
  const dec = (n: number) => n.toFixed(2);
  const none = t("finance.reports.unassigned");

  let filename = "";
  let headers: string[] = [];
  let rows: CsvCell[][] = [];

  if (kind === "payouts") {
    const month = isMonth(p("month")) ? p("month")! : today.slice(0, 7);
    const r = await payoutReport(me.orgId, month);
    if (r.error !== null) return fail(r.error);
    filename = `coach-payouts_${month}.csv`;
    headers = [t("finance.expenses.coach"), t("finance.payouts.rateType"), t("finance.payouts.rate"), t("finance.filters.currency"), t("finance.payouts.sessions"),
      t("finance.payouts.bookings"), t("finance.payouts.minutes"), t("finance.payouts.basis"), t("finance.common.amount"), t("finance.common.status"), t("finance.expenses.paidOn")];
    rows = r.data.map((l) => [l.coachName, l.rate ? t(`finance.payouts.rateTypes.${l.rate.rateType}`) : "", l.rate ? dec(l.rate.amount) : "", l.rate?.currency ?? "",
      l.activity.sessions, l.activity.bookings, l.calc?.minutes ?? l.activity.sessionMinutes + l.activity.bookingMinutes,
      l.calc ? t(`finance.payouts.bases.${l.calc.basis}`) : "", l.payout ? dec(l.payout.amount) : l.calc ? dec(l.calc.amount) : "",
      l.payout ? t("finance.expenses.statuses.paid") : t("finance.payouts.open"), l.payout?.paidOn ?? ""]);
  } else if (kind === "expenses") {
    const status = p("status") === "paid" || p("status") === "unpaid" ? (p("status") as "paid" | "unpaid") : undefined;
    const [r, facts] = await Promise.all([
      listExpenses(me.orgId, { from: range.from, to: range.to, status, categoryId: isUuid(p("category")) ? p("category")! : undefined,
        supplierId: isUuid(p("supplier")) ? p("supplier")! : undefined, q: (p("q") ?? "").slice(0, 100) || undefined }),
      loadFacts(me.orgId, ctx.currency),
    ]);
    if (r.error !== null) return fail(r.error);
    if (facts.error !== null) return fail(facts.error);
    const refs = facts.data.refs;
    const name = (list: { id: string; name: string }[], id: string | null) => (id ? list.find((x) => x.id === id)?.name ?? "" : "");
    filename = `expenses_${suffix}.csv`;
    headers = [t("finance.common.date"), t("finance.common.amount"), t("finance.filters.currency"), t("finance.expenses.category"), t("finance.expenses.supplier"),
      t("finance.expenses.coach"), t("finance.expenses.program"), t("finance.expenses.camp"), t("finance.expenses.team"), t("finance.expenses.location"),
      t("finance.common.description"), t("finance.common.method"), t("finance.common.status"), t("finance.expenses.paidOn"), t("finance.expenses.recurring"), t("finance.receipt.title")];
    rows = r.data.map((e) => [e.date, dec(e.amount), e.currency, name(refs.categories, e.categoryId), name(refs.suppliers, e.supplierId), name(refs.coaches, e.coachId),
      name(refs.programs, e.programId), name(refs.camps, e.campEditionId), name(refs.teams, e.teamId), name(refs.venues, e.venueId), e.description,
      t(`finance.methods.${e.method as "cash"}`), t(`finance.expenses.statuses.${e.status}`), e.paidOn, e.recurringMonthly || e.isRecurringCopy ? t("common.yes") : t("common.no"),
      e.hasReceipt ? t("common.yes") : t("common.no")]);
  } else {
    const facts = await loadFacts(me.orgId, ctx.currency);
    if (facts.error !== null) return fail(facts.error);
    const currencies = currenciesIn(facts.data, ctx.currency);
    const currency = isCurrency(p("currency")) && currencies.includes(p("currency")!) ? p("currency")! : ctx.currency;
    const profit = (label: string, list: LabeledProfit[]) => {
      headers = [label, t("finance.reports.revenue"), t("finance.reports.expenses"), t("finance.reports.profit"), t("finance.filters.currency")];
      rows = list.map((x) => [x.label ?? none, dec(x.revenue), dec(x.expenses), dec(x.profit), currency]);
    };
    switch (kind) {
      case "balances": {
        filename = `family-balances_${today}.csv`;
        headers = [t("finance.balances.family"), t("finance.balances.invoices"), t("finance.balances.invoiced"), t("finance.balances.paid"), t("finance.balances.credits"), t("finance.balances.outstanding"), t("finance.filters.currency")];
        rows = balancesFromFacts(facts.data).filter((b) => b.currency === currency)
          .map((b) => [b.familyName, b.invoices, dec(b.invoiced), dec(b.paid), dec(b.credits), dec(b.outstanding), b.currency]);
        break;
      }
      case "ledger": {
        const type = (LEDGER_TYPES as readonly string[]).includes(p("type") ?? "") ? (p("type") as LedgerType) : undefined;
        filename = `transactions_${suffix}.csv`;
        headers = [t("finance.common.date"), t("finance.ledger.type"), t("finance.ledger.reference"), t("finance.ledger.party"), t("finance.common.description"), t("finance.common.amount"), t("finance.filters.currency")];
        rows = ledgerFromFacts(facts.data, range, { types: type ? [type] : undefined, currency })
          .map((x) => [x.date, t(`finance.ledger.types.${x.type}`), x.reference, x.party, x.description, dec(x.amount), x.currency]);
        break;
      }
      default: {
        const rep = buildFinancialReport(facts.data, range, currency, today);
        switch (kind) {
          case "report-month": filename = `profit-by-month_${suffix}.csv`; profit(t("finance.reports.month"), rep.byMonth); break;
          case "report-program": filename = `profit-by-programme_${suffix}.csv`; profit(t("finance.expenses.program"), rep.byProgram); break;
          case "report-camp": filename = `profit-by-camp_${suffix}.csv`; profit(t("finance.expenses.camp"), rep.byCamp); break;
          case "report-location": filename = `profit-by-location_${suffix}.csv`; profit(t("finance.expenses.location"), rep.byLocation); break;
          case "report-methods":
            filename = `payments-recorded_${suffix}.csv`;
            headers = [t("finance.common.method"), t("finance.reports.count"), t("finance.common.amount"), t("finance.filters.currency")];
            rows = rep.recorded.byMethod.map((m) => [t.dynamic(`payments.methods.${m.method}`, undefined, m.method), m.count, dec(m.amount), currency]);
            break;
          case "report-categories":
            filename = `expenses-by-category_${suffix}.csv`;
            headers = [t("finance.expenses.category"), t("finance.reports.count"), t("finance.expenses.unpaid"), t("finance.common.amount"), t("finance.filters.currency")];
            rows = rep.categories.map((c) => [c.label ?? t("finance.reports.uncategorised"), c.count, dec(c.unpaid), dec(c.amount), currency]);
            break;
          case "report-projection":
            filename = `projected-earnings_${today}.csv`;
            headers = [t("finance.reports.month"), t("finance.reports.openInvoices"), t("finance.reports.upcomingTraining"), t("finance.reports.upcomingCamps"), t("finance.reports.total"), t("finance.filters.currency")];
            rows = [[t("finance.reports.overdue"), dec(rep.projection.overdue), "", "", dec(rep.projection.overdue), currency],
              ...rep.projection.rows.map((r) => [r.month, dec(r.invoices), dec(r.training), dec(r.camps), dec(r.total), currency])];
            break;
          default:
            return NextResponse.json({ error: "Unknown export" }, { status: 400 });
        }
      }
    }
  }

  await writeAudit({ id: me.id, orgId: me.orgId }, "finance.export", "finance", null, { kind, from: range.from, to: range.to, rows: rows.length });
  return new NextResponse("﻿" + toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import fixture from "./fixtures/club-membership-report.json";
import {
  membershipTotals, resolveMembershipFilters, seasonMonths, statusCounts, sumMinor, toMembershipReportRow, toSeasonOverview,
  type MembershipReportDbRow, type SeasonOverviewDbRow,
} from "@/lib/finance-reports/membership-report";
import {
  buildMembershipWorkbook, FILL_MISSED, FILL_NO_INSTALLMENT, MONTHLY_COLUMNS, overviewCellState, type MembershipWorkbookLabels,
} from "@/lib/finance-reports/membership-workbook";
import {
  buildSelectionWorkbook, filterSelectionRows, resolveSelectionFilters, selectionTotals, SELECTION_COLUMNS, type SelectionPaymentRow,
} from "@/lib/finance-reports/selection-report";
import { buildTransactionsWorkbook, toTransaction, transactionCsvRows, TRANSACTION_COLUMNS, type TransactionLabels } from "@/lib/finance-reports/transactions";
import { reportErrorKey } from "@/lib/finance-reports/errors";

// Fixture = real output of public.club_membership_month_report (October 2024)
// and club_membership_season_overview for the synthetic members of
// tests/db/finance_reports.sql (early, late, partial, split payer, zero, sponsored).
const rows = (fixture.monthReport as unknown as MembershipReportDbRow[]).map(toMembershipReportRow);
const overview = toSeasonOverview(fixture.overview as unknown as SeasonOverviewDbRow[]);
const months = seasonMonths(fixture.season.startsOn, fixture.season.endsOn);

const labels: MembershipWorkbookLabels = {
  monthlySheet: "Monthly Report",
  overviewSheet: "Season Overview",
  title: "Club membership payments · FR season 2024-25 · October 2024",
  columns: Object.fromEntries(MONTHLY_COLUMNS.map((c) => [c, `col:${c}`])) as MembershipWorkbookLabels["columns"],
  status: { paid: "Paid", partially_paid: "Partially paid", unpaid: "Unpaid", no_installment: "No installment", overdue: "Overdue", sponsored: "Sponsored" },
  total: (c) => `Total ${c}`,
  monthLabel: (m) => m,
  expected: "expected",
  received: "received",
  totalPaid: "Total paid",
  remainingBalance: "Remaining balance",
  noInstallmentMark: "—",
  legendNoInstallment: "No installment scheduled",
  legendMissed: "Missed",
};

async function roundTrip(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf as ArrayBuffer);
  return back;
}

const byName = (name: string) => rows.find((r) => r.athleteName.endsWith(name))!;

describe("membership report rows (fixture from the SQL function)", () => {
  it("has one row per membership and the expected October numbers", () => {
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.membershipId)).size).toBe(6);
    const late = rows.find((r) => r.receivedInMonth === 200)!;
    expect(late).toMatchObject({ dueInMonth: 100, appliedToMonth: 0, openForMonth: 100, status: "unpaid", seasonBalance: 900 });
    expect(byName("Sponsored").status).toBe("sponsored");
    expect(byName("Zero").status).toBe("overdue");
  });

  it("totals per currency are exact sums of the rows", () => {
    const [tot] = membershipTotals(rows);
    expect(tot.currency).toBe("CHF");
    expect(tot.members).toBe(6);
    expect(tot.dueInMonth).toBe(500);
    expect(tot.receivedInMonth).toBe(200);
    for (const k of ["agreedFee", "dueInMonth", "receivedInMonth", "appliedToMonth", "openForMonth", "overdueAmount", "paidToDate", "seasonBalance"] as const) {
      expect(tot[k]).toBe(sumMinor(rows.map((r) => r[k]), "CHF"));
    }
    const counts = statusCounts(rows);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe("membership workbook", () => {
  it("Monthly Report sheet: same numbers as the report rows + CHF totals", async () => {
    const wb = await roundTrip(buildMembershipWorkbook({ labels, rows, overview, months, today: "2026-11-22" }));
    const ws = wb.getWorksheet("Monthly Report")!;
    expect(ws.getRow(1).getCell(1).value).toBe(labels.title);
    expect(ws.getRow(2).getCell(1).value).toBe("col:player");
    const col = (c: (typeof MONTHLY_COLUMNS)[number]) => MONTHLY_COLUMNS.indexOf(c) + 1;
    rows.forEach((r, i) => {
      const row = ws.getRow(3 + i);
      expect(row.getCell(col("player")).value).toBe(r.athleteName);
      expect(row.getCell(col("agreedFee")).value).toBe(r.agreedFee);
      expect(row.getCell(col("dueInMonth")).value).toBe(r.dueInMonth);
      expect(row.getCell(col("receivedInMonth")).value).toBe(r.receivedInMonth);
      expect(row.getCell(col("appliedToMonth")).value).toBe(r.appliedToMonth);
      expect(row.getCell(col("openForMonth")).value).toBe(r.openForMonth);
      expect(row.getCell(col("overdueAmount")).value).toBe(r.overdueAmount);
      expect(row.getCell(col("seasonBalance")).value).toBe(r.seasonBalance);
      expect(row.getCell(col("carryForwardDue")).value).toBe(r.carryForwardDue);
      expect(row.getCell(col("status")).value).toBe(labels.status[r.status]);
      expect(row.getCell(col("dueInMonth")).numFmt).toBe("#,##0.00");
    });
    const total = ws.getRow(3 + rows.length);
    const [tot] = membershipTotals(rows);
    expect(total.getCell(col("player")).value).toBe("Total CHF");
    expect(total.getCell(col("dueInMonth")).value).toBe(tot.dueInMonth);
    expect(total.getCell(col("receivedInMonth")).value).toBe(tot.receivedInMonth);
    expect(total.getCell(col("seasonBalance")).value).toBe(tot.seasonBalance);
  });

  it("Season Overview sheet: expected / received per month, no-instalment and missed months marked", async () => {
    const wb = await roundTrip(buildMembershipWorkbook({ labels, rows, overview, months, today: "2026-11-22" }));
    const ws = wb.getWorksheet("Season Overview")!;
    expect(months).toEqual(["2024-08", "2024-09", "2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07"]);
    expect(ws.getRow(2).getCell(6).value).toBe("2024-08 · expected");
    expect(ws.getRow(2).getCell(7).value).toBe("2024-08 · received");
    const fixed = 5;
    rows.forEach((r, i) => {
      const row = ws.getRow(3 + i);
      const o = overview.find((x) => x.membershipId === r.membershipId)!;
      o.months.forEach((c, m) => {
        const exp = row.getCell(fixed + 1 + m * 2);
        const rec = row.getCell(fixed + 2 + m * 2);
        expect(rec.value).toBe(c.received);
        const state = overviewCellState(c, "2026-11-22");
        if (state === "no_installment") {
          expect(exp.value).toBe("—");
          expect((exp.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(FILL_NO_INSTALLMENT);
        } else {
          expect(exp.value).toBe(c.due);
          if (state === "missed") expect((exp.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(FILL_MISSED);
        }
      });
      expect(row.getCell(fixed + months.length * 2 + 1).value).toBe(o.paidToDate);
      expect(row.getCell(fixed + months.length * 2 + 2).value).toBe(o.seasonBalance);
    });
    // July: no instalment for anyone (11 instalments Aug..Jun) -> grey "—"; the zero payer's months are missed (red).
    const zeroIdx = rows.findIndex((r) => r.athleteName.endsWith("Zero"));
    const zeroRow = ws.getRow(3 + zeroIdx);
    expect(zeroRow.getCell(fixed + 1 + 11 * 2).value).toBe("—");
    expect((zeroRow.getCell(fixed + 1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe(FILL_MISSED);
    // Totals row: expected per month sums the members' expected amounts.
    const totalRow = ws.getRow(3 + rows.length);
    expect(totalRow.getCell(1).value).toBe("Total CHF");
    const augDue = sumMinor(overview.map((o) => o.months[0].due), "CHF");
    expect(totalRow.getCell(fixed + 1).value).toBe(augDue);
    expect(augDue).toBe(500);
  });

  it("cell states", () => {
    expect(overviewCellState({ month: "2024-08", due: 0, open: 0 }, "2026-01-01")).toBe("no_installment");
    expect(overviewCellState({ month: "2024-08", due: 100, open: 0 }, "2026-01-01")).toBe("paid");
    expect(overviewCellState({ month: "2024-08", due: 100, open: 50 }, "2024-08-15")).toBe("open");
    expect(overviewCellState({ month: "2024-08", due: 100, open: 50 }, "2024-09-01")).toBe("missed");
  });
});

describe("filters", () => {
  const seasons = [
    { id: "00000000-0000-0000-0000-000000000001", name: "2025-26", startsOn: "2025-08-01", endsOn: "2026-07-31", isCurrent: false },
    { id: "00000000-0000-0000-0000-000000000002", name: "2026-27", startsOn: "2026-08-01", endsOn: "2027-07-31", isCurrent: true },
  ];
  it("defaults to the current season and month, refuses months outside the season", () => {
    expect(resolveMembershipFilters({}, seasons, "2026-11")).toMatchObject({ seasonId: seasons[1].id, month: "2026-11" });
    expect(resolveMembershipFilters({ season: seasons[0].id, month: "2026-11" }, seasons, "2026-11")).toMatchObject({ seasonId: seasons[0].id, month: "2025-08" });
    expect(resolveMembershipFilters({ month: "2027-07", status: "overdue", team: "x" }, seasons, "2026-11"))
      .toMatchObject({ month: "2027-07", status: "overdue", teamId: null });
    expect(resolveMembershipFilters({}, [], "2026-11").seasonId).toBeNull();
  });
});

describe("selection report", () => {
  const base: SelectionPaymentRow = {
    applicationId: "a1", athleteName: "Synthetic One", programId: "p", programName: "Synthetic EYBL", series: "EYBL",
    divisionId: "d1", divisionName: "U14", packageName: "3 tournaments", tournaments: [{ id: "t1", name: "Istanbul" }],
    enrolmentStatus: "enrolled", arrangementKind: "monthly", installmentCount: 5, monthlyAmount: 200, currency: "EUR",
    agreedFee: 1000, amountDue: 1000, received: 400, balance: 600, nextDueOn: "2026-12-01", overdueAmount: 200,
    paymentStatus: "partial", invoiceId: "i1",
  };
  const list: SelectionPaymentRow[] = [
    base,
    { ...base, applicationId: "a2", divisionId: "d2", tournaments: [{ id: "t2", name: "Valencia" }], received: 1000, balance: 0, overdueAmount: 0, paymentStatus: "paid" },
  ];
  it("filters by division, tournament and status; totals per currency", () => {
    expect(filterSelectionRows(list, { programId: "p", divisionId: "d2", tournamentId: null, status: null })).toHaveLength(1);
    expect(filterSelectionRows(list, { programId: "p", divisionId: null, tournamentId: "t1", status: null })[0].applicationId).toBe("a1");
    expect(filterSelectionRows(list, { programId: "p", divisionId: null, tournamentId: null, status: "overdue" })).toHaveLength(1);
    expect(filterSelectionRows(list, { programId: "p", divisionId: null, tournamentId: null, status: "paid" })[0].applicationId).toBe("a2");
    expect(selectionTotals(list)).toEqual([{ currency: "EUR", enrolments: 2, agreedFee: 2000, amountDue: 2000, received: 1400, balance: 600, overdueAmount: 200 }]);
    expect(resolveSelectionFilters({ program: "nope" }, ["p1", "p2"]).programId).toBe("p1");
  });
  it("workbook has programme and tournament columns and the same numbers", async () => {
    const wb = await roundTrip(buildSelectionWorkbook(list, {
      sheet: "Selection", title: "T", columns: Object.fromEntries(SELECTION_COLUMNS.map((c) => [c, c])) as never,
      plan: () => "plan", enrolment: (s) => s, status: (s) => s, total: (c) => `Total ${c}`,
    }));
    const ws = wb.getWorksheet("Selection")!;
    const col = (c: (typeof SELECTION_COLUMNS)[number]) => SELECTION_COLUMNS.indexOf(c) + 1;
    expect(ws.getRow(3).getCell(col("programme")).value).toBe("Synthetic EYBL");
    expect(ws.getRow(3).getCell(col("tournaments")).value).toBe("Istanbul");
    expect(ws.getRow(4).getCell(col("received")).value).toBe(1000);
    expect(ws.getRow(5).getCell(col("received")).value).toBe(1400);
    expect(ws.getRow(5).getCell(col("balance")).value).toBe(600);
  });
});

describe("accounting transactions export", () => {
  const tx = [
    toTransaction({ kind: "payment", txn_date: "2024-08-05", document_number: null, invoice_id: "i", invoice_number: "DL CLUB-2026-0001",
      invoice_reference: "RF18", payment_reference: "QR-1", category: "club_membership", category_label: null, billing_entity_id: "e",
      billing_entity_name: "Synthetic Club", source_label: "Season 2024-25", family_name: "Synthetic family", payer_name: null,
      description: null, method: "bank_transfer", status: "succeeded", amount: "1100.00", currency: "chf" }),
    toTransaction({ kind: "credit_note", txn_date: "2024-12-15", document_number: "CN-1", invoice_id: "i", invoice_number: "DL CLUB-2026-0001",
      invoice_reference: null, payment_reference: null, category: "club_membership", category_label: null, billing_entity_id: "e",
      billing_entity_name: "Synthetic Club", source_label: null, family_name: null, payer_name: null, description: "Goodwill",
      method: null, status: "active", amount: -100, currency: "CHF" }),
  ];
  const L: TransactionLabels = {
    sheet: "Transactions", columns: Object.fromEntries(TRANSACTION_COLUMNS.map((c) => [c, c])) as never,
    kind: (k) => k, category: (t) => t.category, method: (m) => m, status: (s) => s,
  };
  it("CSV rows keep the original invoice number, references and signed amounts", () => {
    const c = transactionCsvRows(tx, L);
    expect(c.headers).toEqual([...TRANSACTION_COLUMNS]);
    const at = (k: (typeof TRANSACTION_COLUMNS)[number]) => TRANSACTION_COLUMNS.indexOf(k);
    expect(c.rows[0][at("invoiceNumber")]).toBe("DL CLUB-2026-0001");
    expect(c.rows[0][at("paymentReference")]).toBe("QR-1");
    expect(c.rows[0][at("amount")]).toBe("1100.00");
    expect(c.rows[0][at("currency")]).toBe("CHF");
    expect(c.rows[1][at("amount")]).toBe("-100.00");
    expect(c.rows[1][at("documentNumber")]).toBe("CN-1");
  });
  it("xlsx has numeric amounts", async () => {
    const wb = await roundTrip(buildTransactionsWorkbook(tx, L));
    const ws = wb.getWorksheet("Transactions")!;
    expect(ws.getRow(2).getCell(TRANSACTION_COLUMNS.indexOf("amount") + 1).value).toBe(1100);
    expect(ws.getRow(3).getCell(TRANSACTION_COLUMNS.indexOf("amount") + 1).value).toBe(-100);
  });
});

describe("error keys", () => {
  it("maps database codes", () => {
    expect(reportErrorKey("MONTH_OUTSIDE_SEASON")).toBe("financeReports.errors.MONTH_OUTSIDE_SEASON");
    expect(reportErrorKey("boom")).toBe("financeReports.errors.generic");
  });
});

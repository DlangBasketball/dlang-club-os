import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Label, PageHeader, Select, StatCard } from "@/components/ui";
import { FinTable } from "@/components/finance/fin-table";
import { getI18n } from "@/lib/i18n/server";
import { getSelectionPayments, requireFinanceUser } from "@/lib/finance-reports/data";
import {
  filterSelectionRows, resolveSelectionFilters, selectionQuery, selectionTotals, SELECTION_PAY_FILTERS,
  type SelectionPaymentRow, type SelectionTotals,
} from "@/lib/finance-reports/selection-report";
import { selectionPlanLabel } from "@/lib/finance-reports/labels";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("financeReports.selection.title") };
}

const PAY_TONE = { paid: "success", partial: "warning", unpaid: "danger", none: "neutral" } as const;
type SP = Record<string, string | string[] | undefined>;

/**
 * Finance → Selection payments: enrolments of one selection programme (e.g.
 * EYBL) with agreed fee, plan, paid, balance, next due date and overdue
 * (public.selection_roster). Admin / finance only.
 */
export default async function SelectionPaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [me, { t, f }, sp] = await Promise.all([requireFinanceUser(), getI18n(), searchParams]);
  if (!me) redirect("/admin/dashboard");
  const title = t("financeReports.selection.title");
  const programParam = typeof sp.program === "string" ? sp.program : null;
  const first = await getSelectionPayments(me.orgId, programParam);
  if (first.error !== null) {
    return <div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("financeReports.common.loadError")} message={first.error} /></div>;
  }
  const programs = first.data.programs;
  const filters = resolveSelectionFilters(sp, programs.map((p) => p.id));
  const res = filters.programId === programParam ? first : await getSelectionPayments(me.orgId, filters.programId);
  if (res.error !== null) {
    return <div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("financeReports.common.loadError")} message={res.error} /></div>;
  }
  const program = programs.find((p) => p.id === filters.programId);
  if (!program) {
    return (
      <div className="animate-fade-up">
        <PageHeader title={title} description={t("financeReports.selection.description")} />
        <EmptyState title={t("financeReports.selection.noPrograms")} />
      </div>
    );
  }
  const rows = filterSelectionRows(res.data.rows, filters);
  const totals = selectionTotals(rows);
  const money = (n: number, c: string) => f.money(n, c);
  const plan = (r: SelectionPaymentRow) => selectionPlanLabel(r, t, money);
  const payLabel = (s: string) => t.dynamic(`financeReports.selection.statuses.${s}`);
  const exportHref = `/admin/finance/selection-payments/export?${selectionQuery(filters)}`;

  const cols = [
    { key: "player", header: t("financeReports.selection.cols.player"), cell: (r: SelectionPaymentRow) => <span className="font-medium text-ink">{r.athleteName}</span> },
    { key: "division", header: t("financeReports.selection.cols.division"), cell: (r: SelectionPaymentRow) => r.divisionName ?? "—" },
    { key: "tournaments", header: t("financeReports.selection.cols.tournaments"), cell: (r: SelectionPaymentRow) => (
      <span className="line-clamp-2 text-xs">{r.tournaments.map((x) => x.name).join(", ") || "—"}</span>
    ) },
    { key: "fee", header: t("financeReports.selection.cols.agreedFee"), align: "right" as const, cell: (r: SelectionPaymentRow) => money(r.agreedFee, r.currency) },
    { key: "plan", header: t("financeReports.selection.cols.plan"), cell: (r: SelectionPaymentRow) => plan(r) },
    { key: "received", header: t("financeReports.selection.cols.received"), align: "right" as const, cell: (r: SelectionPaymentRow) => money(r.received, r.currency) },
    { key: "balance", header: t("financeReports.selection.cols.balance"), align: "right" as const, cell: (r: SelectionPaymentRow) => money(r.balance, r.currency) },
    { key: "next", header: t("financeReports.selection.cols.nextDue"), cell: (r: SelectionPaymentRow) => (r.nextDueOn ? f.date(r.nextDueOn) : "—") },
    { key: "overdue", header: t("financeReports.selection.cols.overdue"), align: "right" as const, cell: (r: SelectionPaymentRow) => (
      <span className={r.overdueAmount > 0 ? "text-danger" : "text-ink-3"}>{money(r.overdueAmount, r.currency)}</span>
    ) },
    { key: "status", header: t("financeReports.selection.cols.status"), cell: (r: SelectionPaymentRow) => (
      <span className="inline-flex flex-wrap gap-1">
        {r.invoiceId
          ? <Link href={`/admin/invoices/${r.invoiceId}`}><Badge tone={PAY_TONE[r.paymentStatus]}>{payLabel(r.paymentStatus)}</Badge></Link>
          : <Badge tone="neutral">{payLabel(r.paymentStatus)}</Badge>}
        {r.enrolmentStatus !== "enrolled" && <Badge tone="neutral">{t.dynamic(`financeReports.selection.enrolments.${r.enrolmentStatus}`)}</Badge>}
      </span>
    ) },
  ];
  const totalRow = (x: SelectionTotals) => (
    <tr key={x.currency} className="font-medium text-ink">
      <td className="px-5 py-2.5" colSpan={3}>{t("financeReports.common.total", { currency: x.currency })} · {t("financeReports.selection.enrollments", { count: x.enrolments })}</td>
      <td className="whitespace-nowrap px-5 py-2.5 text-right tnum">{money(x.agreedFee, x.currency)}</td>
      <td />
      <td className="whitespace-nowrap px-5 py-2.5 text-right tnum">{money(x.received, x.currency)}</td>
      <td className="whitespace-nowrap px-5 py-2.5 text-right tnum">{money(x.balance, x.currency)}</td>
      <td />
      <td className="whitespace-nowrap px-5 py-2.5 text-right tnum">{money(x.overdueAmount, x.currency)}</td>
      <td />
    </tr>
  );

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={title}
        description={t("financeReports.selection.description")}
        actions={
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href={exportHref}><Button variant="secondary"><Download className="h-4 w-4" aria-hidden /> {t("financeReports.common.downloadXlsx")}</Button></a>
        }
      />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="sp-program">{t("financeReports.selection.programme")}</Label>
          <Select id="sp-program" name="program" defaultValue={program.id} className="w-64">
            {programs.map((p) => <option key={p.id} value={p.id}>{p.seasonYear ? `${p.name} · ${p.seasonYear}` : p.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="sp-division">{t("financeReports.selection.division")}</Label>
          <Select id="sp-division" name="division" defaultValue={filters.divisionId ?? ""} className="w-52">
            <option value="">{t("financeReports.selection.allDivisions")}</option>
            {program.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="sp-tournament">{t("financeReports.selection.tournament")}</Label>
          <Select id="sp-tournament" name="tournament" defaultValue={filters.tournamentId ?? ""} className="w-56">
            <option value="">{t("financeReports.selection.allTournaments")}</option>
            {res.data.tournaments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="sp-status">{t("financeReports.selection.cols.status")}</Label>
          <Select id="sp-status" name="status" defaultValue={filters.status ?? ""} className="w-44">
            <option value="">{t("financeReports.common.allStatuses")}</option>
            {SELECTION_PAY_FILTERS.map((s) => <option key={s} value={s}>{payLabel(s)}</option>)}
          </Select>
        </div>
        <Button type="submit" variant="secondary">{t("financeReports.common.apply")}</Button>
      </form>

      {totals.map((x) => (
        <div key={x.currency} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={t("financeReports.selection.cols.agreedFee")} value={money(x.agreedFee, x.currency)} hint={t("financeReports.selection.enrollments", { count: x.enrolments })} />
          <StatCard label={t("financeReports.selection.cols.received")} value={money(x.received, x.currency)} tone="success" />
          <StatCard label={t("financeReports.selection.cols.balance")} value={money(x.balance, x.currency)} tone={x.balance > 0 ? "warning" : "brand"} />
          <StatCard label={t("financeReports.selection.cols.overdue")} value={money(x.overdueAmount, x.currency)} tone={x.overdueAmount > 0 ? "danger" : "brand"} />
        </div>
      ))}
      <FinTable
        title={program.name}
        caption={title}
        rows={rows}
        rowKey={(r) => r.applicationId}
        empty={t("financeReports.selection.empty")}
        cols={cols}
        footer={totals.length ? <>{totals.map(totalRow)}</> : undefined}
      />
    </div>
  );
}

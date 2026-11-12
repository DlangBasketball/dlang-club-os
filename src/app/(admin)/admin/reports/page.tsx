import Link from "next/link";
import { PageHeader, Button, StatCard, ErrorState } from "@/components/ui";
import { Input } from "@/components/ui";
import { RateBar, ReportCard } from "@/components/reports/report-card";
import { attendanceReport, defaultRange, outstandingReceivables, registrationsByProgram, revenueByProgram, type Range } from "@/lib/sportsops/reports";
import { isDayKey } from "@/lib/sportsops/time";
import { formatCHF } from "@/lib/utils";
import { getFormatter } from "@/lib/i18n/server";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const f = await getFormatter();
  const sp = await searchParams;
  const def = await defaultRange();
  const range: Range = {
    from: isDayKey(sp.from) ? sp.from : def.from,
    to: isDayKey(sp.to) ? sp.to : def.to,
  };
  if (range.to < range.from) [range.from, range.to] = [range.to, range.from];

  const [att, rev, ar, reg] = await Promise.all([attendanceReport(range), revenueByProgram(range), outstandingReceivables(), registrationsByProgram(range)]);
  const firstErr = att.error ?? rev.error ?? ar.error ?? reg.error;
  if (firstErr) return <div className="animate-fade-up"><PageHeader title="Reports" /><ErrorState message={firstErr} /></div>;

  const qs = `from=${range.from}&to=${range.to}`;
  const exp = (type: string) => `/admin/reports/export?type=${type}&${qs}`;
  const totals = {
    invoiced: rev.data!.reduce((s, r) => s + r.invoiced, 0),
    collected: rev.data!.reduce((s, r) => s + r.collected, 0),
    outstanding: ar.data!.reduce((s, r) => s + r.balance, 0),
    overdue: ar.data!.filter((r) => r.daysOverdue > 0).reduce((s, r) => s + r.balance, 0),
    marks: att.data!.byTeam.reduce((s, r) => s + r.marks, 0),
    attended: att.data!.byTeam.reduce((s, r) => s + r.present + r.late, 0),
    registrations: reg.data!.reduce((s, r) => s + r.total, 0),
  };
  const overallRate = totals.marks ? Math.round((totals.attended / totals.marks) * 1000) / 10 : null;
  const lowAttendance = att.data!.byAthlete.filter((a) => a.rate != null && a.rate < 70 && a.marks >= 4);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Reports" description={`${f.date(range.from)} – ${f.date(range.to)}. Receivables are as of today.`} />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div><label htmlFor="from" className="mb-1.5 block text-xs font-medium text-ink-2">From</label><Input id="from" name="from" type="date" defaultValue={range.from} className="w-44" /></div>
        <div><label htmlFor="to" className="mb-1.5 block text-xs font-medium text-ink-2">To</label><Input id="to" name="to" type="date" defaultValue={range.to} className="w-44" /></div>
        <Button type="submit" size="sm" variant="secondary" className="h-10">Update</Button>
        <Link href="/admin/reports" className="pb-2.5 text-xs text-ink-3 hover:text-ink">Reset to current season</Link>
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Attendance rate" value={overallRate == null ? "—" : `${overallRate.toFixed(1)}%`} hint={`${totals.marks} check-ins`} />
        <StatCard label="Invoiced" value={formatCHF(totals.invoiced)} hint={`${formatCHF(totals.collected)} collected`} />
        <StatCard label="Outstanding" value={formatCHF(totals.outstanding)} hint={`${formatCHF(totals.overdue)} overdue`} accent={totals.overdue > 0} />
        <StatCard label="Registrations" value={String(totals.registrations)} hint={`${reg.data!.length} programs`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ReportCard title="Attendance by team" subtitle="Present + late ÷ all marks. Sessions map to a team through its linked program."
          exportHref={exp("attendance-teams")} rows={att.data!.byTeam} rowKey={(r) => r.key}
          cols={[
            { header: "Team / program", cell: (r) => <span className="text-ink">{r.group}</span> },
            { header: "Sessions", align: "right", cell: (r) => r.sessions },
            { header: "Absent", align: "right", cell: (r) => r.absent },
            { header: "Rate", align: "right", cell: (r) => <RateBar rate={r.rate} /> },
          ]} />
        <ReportCard title="Revenue by program" subtitle="Invoices issued in the period (void, cancelled and drafts excluded)."
          exportHref={exp("revenue")} rows={rev.data!} rowKey={(r) => r.programId ?? "none"}
          cols={[
            { header: "Program", cell: (r) => <span className="text-ink">{r.program}</span> },
            { header: "Invoices", align: "right", cell: (r) => r.invoices },
            { header: "Invoiced", align: "right", cell: (r) => formatCHF(r.invoiced) },
            { header: "Collected", align: "right", cell: (r) => formatCHF(r.collected) },
            { header: "Open", align: "right", cell: (r) => formatCHF(r.outstanding) },
          ]} />
      </div>

      <ReportCard title="Outstanding receivables" subtitle="Open, sent, partially paid and overdue invoices with a balance."
        exportHref={exp("receivables")} rows={ar.data!} rowKey={(r) => r.invoiceId}
        cols={[
          { header: "Invoice", cell: (r) => <Link href={`/admin/invoices/${r.invoiceId}`} className="font-mono text-ink hover:text-maroon">{r.number}</Link> },
          { header: "Family", cell: (r) => r.family },
          { header: "Program", cell: (r) => r.program },
          { header: "Due", cell: (r) => (r.dueDate ? f.date(r.dueDate) : "—") },
          { header: "Aging", cell: (r) => <span className={r.daysOverdue > 30 ? "text-danger" : r.daysOverdue > 0 ? "text-warning" : ""}>{r.bucket === "current" ? "current" : `${r.bucket} days`}</span> },
          { header: "Balance", align: "right", cell: (r) => <span className="text-ink">{formatCHF(r.balance)}</span> },
        ]} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ReportCard title="Registrations by program" subtitle="Registrations created in the period. Fill = confirmed ÷ capacity."
          exportHref={exp("registrations")} rows={reg.data!} rowKey={(r) => r.programId}
          cols={[
            { header: "Program", cell: (r) => <span className="text-ink">{r.program}</span> },
            { header: "Confirmed", align: "right", cell: (r) => r.confirmed + r.completed },
            { header: "Pending", align: "right", cell: (r) => r.pending },
            { header: "Waitlist", align: "right", cell: (r) => r.waitlist },
            { header: "Fill", align: "right", cell: (r) => <RateBar rate={r.fill} /> },
          ]} />
        <ReportCard title="Attendance by athlete" subtitle={lowAttendance.length ? `${lowAttendance.length} below 70% (4+ sessions) — lowest first` : "Lowest attendance first"}
          exportHref={exp("attendance-athletes")} rows={att.data!.byAthlete.slice(0, 25)} rowKey={(r) => r.athleteId}
          cols={[
            { header: "Athlete", cell: (r) => <Link href={`/admin/athletes/${r.athleteId}`} className="text-ink hover:text-maroon">{r.name}</Link> },
            { header: "Team", cell: (r) => r.teams || "—" },
            { header: "Sessions", align: "right", cell: (r) => r.marks },
            { header: "Rate", align: "right", cell: (r) => <RateBar rate={r.rate} /> },
          ]} />
      </div>
    </div>
  );
}

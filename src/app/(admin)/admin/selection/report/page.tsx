import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { Button, Card, CardBody, EmptyState, ErrorState, PageHeader, Select } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getSelectionPrograms, getSelectionReport, getSelectionSetup } from "@/lib/selection/data";
import { ApplicationStatusBadge } from "@/components/selection/shared";
import { parseReportFilters, reportQuery } from "@/lib/selection/report";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("selection.report.title") };
}

/** Finance report per selection programme (season, division, package) with CSV export. */
export default async function SelectionReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const filters = parseReportFilters(await searchParams);
  const programs = await getSelectionPrograms(me.orgId);
  const setup = filters.programId ? await getSelectionSetup(me.orgId, filters.programId) : null;
  const report = await getSelectionReport(filters);
  const seasons = Array.from(new Set(programs.map((p) => p.seasonYear).filter((y): y is number => y != null))).sort((a, b) => b - a);
  const rows = report.data;
  const totals = new Map<string, { invoiced: number; sponsored: number; collected: number; outstanding: number }>();
  for (const r of rows) {
    const x = totals.get(r.currency) ?? { invoiced: 0, sponsored: 0, collected: 0, outstanding: 0 };
    x.invoiced += r.invoiced; x.sponsored += r.sponsored; x.collected += r.collected; x.outstanding += r.outstanding;
    totals.set(r.currency, x);
  }

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/selection" className="hover:underline">{t("selection.admin.title")}</Link>}
        title={t("selection.report.title")} description={t("selection.report.description")}
        actions={<a href={`/admin/selection/report/export?${reportQuery(filters)}`}><Button variant="secondary"><Download className="h-4 w-4" /> {t("selection.report.export")}</Button></a>} />
      <Card><CardBody>
        <form method="get" className="grid gap-3 sm:grid-cols-5">
          <Select name="program" aria-label={t("selection.report.program")} defaultValue={filters.programId ?? ""}>
            <option value="">{t("selection.report.allPrograms")}</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select name="season" aria-label={t("selection.report.season")} defaultValue={filters.season ? String(filters.season) : ""}>
            <option value="">{t("selection.report.allSeasons")}</option>
            {seasons.map((y) => <option key={y} value={y}>{t("selection.report.seasonValue", { from: y, to: (y + 1) % 100 })}</option>)}
          </Select>
          <Select name="division" aria-label={t("selection.report.division")} defaultValue={filters.divisionId ?? ""} disabled={!setup}>
            <option value="">{t("selection.report.allDivisions")}</option>
            {setup?.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select name="package" aria-label={t("selection.report.package")} defaultValue={filters.packageId ?? ""} disabled={!setup}>
            <option value="">{t("selection.report.allPackages")}</option>
            {setup?.packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button type="submit">{t("selection.report.apply")}</Button>
        </form>
        {!setup && <p className="mt-2 text-xs text-text-muted">{t("selection.report.pickProgram")}</p>}
      </CardBody></Card>

      {report.error ? <ErrorState message={report.error} /> : rows.length === 0 ? <EmptyState title={t("selection.report.empty")} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {Array.from(totals.entries()).flatMap(([cur, x]) => ([
              ["invoiced", x.invoiced], ["collected", x.collected], ["outstanding", x.outstanding], ["sponsored", x.sponsored],
            ] as const).map(([k, v]) => (
              <Card key={`${cur}-${k}`}><CardBody>
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t(`selection.dashboard.${k}`)}</p>
                <p className="font-display text-xl tnum text-text">{f.money(v, cur)}</p>
              </CardBody></Card>
            )))}
          </div>
          <Card><CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border text-xs text-text-muted">
                <tr>
                  {(["player", "division", "package", "status", "member", "invoice", "invoiced", "sponsored", "collected", "outstanding", "plan"] as const).map((k) => (
                    <th key={k} className={`px-3 py-2 font-medium ${["invoiced", "sponsored", "collected", "outstanding"].includes(k) ? "text-right" : ""}`}>{t(`selection.report.columns.${k}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.applicationId}>
                    <td className="px-3 py-2"><span className="text-text">{r.athleteName}</span><span className="block text-xs text-text-muted">{[r.birthYear, r.familyName].filter(Boolean).join(" · ")}</span></td>
                    <td className="px-3 py-2">{r.divisionName ?? "—"}</td>
                    <td className="px-3 py-2">{r.packageName ?? "—"}</td>
                    <td className="px-3 py-2"><ApplicationStatusBadge status={r.status} /></td>
                    <td className="px-3 py-2">{r.isMember ? t("selection.report.member") : r.currentClub ?? t("selection.report.nonMember")}</td>
                    <td className="px-3 py-2">{r.invoiceNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-right tnum">{f.money(r.invoiced, r.currency)}</td>
                    <td className="px-3 py-2 text-right tnum">{f.money(r.sponsored, r.currency)}</td>
                    <td className="px-3 py-2 text-right tnum">{f.money(r.collected, r.currency)}</td>
                    <td className="px-3 py-2 text-right tnum">{f.money(r.outstanding, r.currency)}</td>
                    <td className="px-3 py-2">{r.installmentCount && r.installmentCount > 1 ? t("selection.report.instalments", { count: r.installmentCount }) : r.installmentCount === 1 ? t("selection.report.inFull") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody></Card>
        </>
      )}
    </div>
  );
}

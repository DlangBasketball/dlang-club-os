import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader, StatCard, ErrorState, Button, Select } from "@/components/ui";
import { ReportCard } from "@/components/reports/report-card";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getSponsorshipReport } from "@/lib/data/sponsorships";
import { parseSeasonParam, seasonFor, seasonOptions } from "@/lib/people/sponsorship";
import type { SponsorshipEntry, SponsorshipTotal } from "@/lib/people/sponsorship-report";

export const metadata = { title: "Sponsorships" };

/**
 * Finance report "Sponsorships <season>": value of club fees waived for
 * sponsored players, per player, per sponsor and in total (per currency),
 * from the sponsorship ledger (sponsored invoice lines, credit notes,
 * cancelled invoices and fees not invoiced). Admin / finance only.
 */
export default async function SponsorshipsPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const [{ t, f }, me, sp] = await Promise.all([getI18n(), getSessionUser(), searchParams]);
  const today = new Date().toISOString().slice(0, 10);
  const season = parseSeasonParam(sp.season) ?? seasonFor(today);
  const title = t("sponsorship.report.title", { season: season.label });
  if (!me || !(me.roles.includes("admin") || me.roles.includes("finance"))) {
    return <div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("sponsorship.errors.forbidden")} /></div>;
  }
  const res = await getSponsorshipReport(season);
  if (res.error !== null) return <div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("common.error")} message={res.error} /></div>;
  const { entries, summary } = res.data;
  const sponsorLabel = (name: string | null) => name ?? t("sponsorship.sponsorClub");
  const totalText = summary.totals.length ? summary.totals.map((x) => f.money(x.amount, x.currency)).join(" · ") : f.money(0);
  const exportHref = `/admin/sponsorships/export?season=${season.label}`;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={title}
        description={t("sponsorship.report.description")}
        actions={<Link href={exportHref} prefetch={false}><Button size="sm" variant="secondary"><Download className="h-4 w-4" aria-hidden /> {t("sponsorship.report.export")}</Button></Link>}
      />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="season" className="mb-1.5 block text-xs font-medium text-ink-2">{t("sponsorship.report.season")}</label>
          <Select id="season" name="season" defaultValue={season.label} className="w-40">
            {seasonOptions(today).map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
          </Select>
        </div>
        <Button type="submit" size="sm" variant="secondary" className="h-10">{t("sponsorship.report.update")}</Button>
      </form>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("sponsorship.report.total")} value={totalText} />
        <StatCard label={t("sponsorship.report.players")} value={String(summary.players)} />
        <StatCard label={t("sponsorship.report.sponsors")} value={String(new Set(summary.bySponsor.map((s) => s.label ?? "")).size)} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ReportCard<SponsorshipTotal & { athleteId: string }>
          title={t("sponsorship.report.byPlayer")} rows={summary.byPlayer} rowKey={(r) => r.key} empty={t("sponsorship.report.empty")}
          cols={[
            { header: t("sponsorship.report.player"), cell: (r) => <Link href={`/admin/athletes/${r.athleteId}`} className="text-ink hover:text-maroon">{r.label ?? "—"}</Link> },
            { header: t("sponsorship.report.count"), align: "right", cell: (r) => r.count },
            { header: t("sponsorship.report.amount"), align: "right", cell: (r) => f.money(r.amount, r.currency) },
          ]} />
        <ReportCard<SponsorshipTotal>
          title={t("sponsorship.report.bySponsor")} rows={summary.bySponsor} rowKey={(r) => r.key} empty={t("sponsorship.report.empty")}
          cols={[
            { header: t("sponsorship.report.sponsor"), cell: (r) => <span className="text-ink">{sponsorLabel(r.label)}</span> },
            { header: t("sponsorship.report.count"), align: "right", cell: (r) => r.count },
            { header: t("sponsorship.report.amount"), align: "right", cell: (r) => f.money(r.amount, r.currency) },
          ]} />
      </div>

      <ReportCard<SponsorshipEntry>
        title={t("sponsorship.report.entries")} rows={entries} rowKey={(r) => r.id} empty={t("sponsorship.report.empty")}
        cols={[
          { header: t("sponsorship.report.date"), cell: (r) => f.date(r.date) },
          { header: t("sponsorship.report.player"), cell: (r) => <Link href={`/admin/athletes/${r.athleteId}`} className="text-ink hover:text-maroon">{r.playerName}</Link> },
          { header: t("sponsorship.report.sponsor"), cell: (r) => sponsorLabel(r.sponsorName) },
          { header: t("sponsorship.report.fee"), cell: (r) => t.dynamic(`sponsorship.scopes.${r.scope}`, undefined, r.scope) },
          { header: t("sponsorship.report.method"), cell: (r) => t.dynamic(`sponsorship.report.methods.${r.method}`, undefined, r.method) },
          { header: t("sponsorship.report.invoice"), cell: (r) => r.invoiceId ? <Link href={`/admin/invoices/${r.invoiceId}`} className="tnum text-ink hover:text-maroon">{r.invoiceNumber ?? "—"}</Link> : "—" },
          { header: t("sponsorship.percent"), align: "right", cell: (r) => f.number(r.percent) },
          { header: t("sponsorship.report.amount"), align: "right", cell: (r) => f.money(r.amount, r.currency) },
        ]} />
    </div>
  );
}

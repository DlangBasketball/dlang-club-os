import Link from "next/link";
import { Trophy } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasFeature } from "@/lib/upgrades/server";
import { getI18n } from "@/lib/i18n/server";
import { getProgramStats, type ProgramStats } from "@/lib/selection/data";

/**
 * Admin dashboard: revenue straight from selection programmes (e.g. an
 * international team), per programme — invoiced, collected, outstanding,
 * sponsored value — and the pipeline per division. Finance / admin only;
 * hidden when the club has no selection programme or the module is off.
 */
export async function SelectionRevenueCard() {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) return null;
  if (!(await hasFeature(me.orgId, "selection_programs"))) return null;
  const [{ data }, { t, f }] = await Promise.all([getProgramStats(null), getI18n()]);
  const programs = data.filter((p) => p.applicants > 0 || p.invoiced > 0 || p.divisions.length > 0);
  if (!programs.length) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><Trophy className="h-4 w-4 text-brand-accent" /> {t("selection.dashboard.title")}</CardTitle>
        <Link href="/admin/selection/report" className="text-xs text-brand-primary hover:underline">{t("selection.dashboard.report")}</Link>
      </CardHeader>
      <CardBody className="space-y-5">
        {programs.map((p) => <ProgramBlock key={p.programId} p={p} t={t} money={(n) => f.money(n, p.currency)} />)}
      </CardBody>
    </Card>
  );
}

function ProgramBlock({ p, t, money }: { p: ProgramStats; t: Awaited<ReturnType<typeof getI18n>>["t"]; money: (n: number) => string }) {
  // Every figure opens the roster (or the applications) already filtered.
  const base = `/admin/selection/${p.programId}`;
  const players = (q: Record<string, string> = {}) => `${base}?${new URLSearchParams({ tab: "players", ...q }).toString()}`;
  const tiles: { label: string; value: string; tone?: string; href: string }[] = [
    { label: t("selection.dashboard.invoiced"), value: money(p.invoiced), href: players({ status: "all" }) },
    { label: t("selection.dashboard.collected"), value: money(p.collected), tone: "text-success", href: players({ status: "all" }) },
    { label: t("selection.dashboard.outstanding"), value: money(p.outstanding), tone: p.outstanding > 0 ? "text-warning" : undefined, href: players({ status: "all", payment: "open" }) },
    { label: t("selection.dashboard.sponsored"), value: money(p.sponsored), tone: "text-brand-accent", href: players({ status: "all", payment: "sponsored" }) },
  ];
  const cell = (n: number, href: string, label: string) => (
    <Link href={href} className="text-brand-primary hover:underline" aria-label={label}>{n}</Link>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={players()} className="font-display text-base text-text hover:underline">{p.name}</Link>
        <span className="text-xs text-text-muted">{t("selection.dashboard.pipeline", { applicants: p.applicants, accepted: p.accepted, enrolled: p.enrolled })}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((x) => (
          <Link key={x.label} href={x.href} className="rounded-lg border border-border bg-surface-elevated/40 p-3 transition-colors hover:border-brand-primary">
            <span className="block text-[11px] uppercase tracking-[0.12em] text-text-muted">{x.label}</span>
            <span className={`mt-1 block font-display text-lg tnum ${x.tone ?? "text-text"}`}>{x.value}</span>
          </Link>
        ))}
      </div>
      {p.divisions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">{t("selection.dashboard.division")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("selection.dashboard.applicants")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("selection.dashboard.toReview")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("selection.dashboard.accepted")}</th>
                <th className="py-1 text-right font-medium">{t("selection.dashboard.enrolled")}</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {p.divisions.map((d) => {
                const div = d.divisionId ?? "none";
                const name = d.name || t("selection.common.noDivision");
                return (
                  <tr key={div} className="border-t border-border">
                    <td className="py-1 pr-3 text-text"><Link href={players({ division: div })} className="hover:underline">{name}</Link></td>
                    <td className="py-1 pr-3 text-right">{cell(d.applicants, `${base}?tab=applications`, `${name}: ${t("selection.dashboard.applicants")}`)}</td>
                    <td className="py-1 pr-3 text-right">{cell(d.pending, `${base}?tab=applications`, `${name}: ${t("selection.dashboard.toReview")}`)}</td>
                    <td className="py-1 pr-3 text-right">{cell(d.accepted, players({ division: div }), `${name}: ${t("selection.dashboard.accepted")}`)}</td>
                    <td className="py-1 text-right">{cell(d.enrolled, players({ division: div, status: "enrolled" }), `${name}: ${t("selection.dashboard.enrolled")}`)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-text-muted">{t("roster.acceptedVsEnrolled")}</p>
        </div>
      )}
    </div>
  );
}

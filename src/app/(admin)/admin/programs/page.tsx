import Link from "next/link";
import { CalendarRange, Plus, MapPin, Pencil, Percent } from "lucide-react";
import { PageHeader, Button, Card, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { listPrograms } from "@/lib/data/programs-admin";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { termOr } from "@/lib/tenant/terms";
import { PROGRAM_KINDS } from "@/lib/club-ops/validation";
import { campSeason, groupBySeason, seasonKey } from "@/lib/camps/seasons";
import type { ProgramListItem } from "@/lib/data/programs-admin";
import { countPendingApprovals } from "@/lib/camps/approval-data";
import { ShieldQuestion } from "lucide-react";

const TONE = { draft: "warning", published: "success", archived: "neutral" } as const;

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<{ kind?: string; season?: string }> }) {
  const { kind, season } = await searchParams;
  const kindFilter = (PROGRAM_KINDS as readonly string[]).includes(kind ?? "") ? kind : null;
  const [me, tenant, { t, f }] = await Promise.all([getSessionUser(), getTenant(), getI18n()]);
  const title = termOr(tenant.terminology, "program", t("nav.programs"), { plural: true });
  if (!me?.orgId) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("editOps.common.noOrgTitle")} message={t("editOps.common.noOrg")} /></div>);
  const { data, error } = await listPrograms(me.orgId);
  if (error) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("editOps.common.loadFailed")} message={error} /></div>);
  const seasonOfProgram = (p: ProgramListItem) => (p.kind === "camp" ? campSeason({ season: p.season, seasonYear: p.seasonYear, firstStart: p.firstWeek ?? p.startsOn }) : null);
  // Camps: season filter (?season=summer-2027) and grouping by season.
  const campSeasons = groupBySeason(data!.filter((p) => p.kind === "camp"), seasonOfProgram).filter((g) => g.season);
  const seasonFilter = campSeasons.some((g) => g.key === season) ? season! : null;
  const programs = (kindFilter || seasonFilter ? data!.filter((p) => p.kind === (seasonFilter ? "camp" : kindFilter)) : data!)
    .filter((p) => !seasonFilter || (seasonOfProgram(p) && seasonKey(seasonOfProgram(p)!) === seasonFilter));
  const grouped = kindFilter === "camp" || seasonFilter
    ? groupBySeason(programs, seasonOfProgram)
    : [{ key: "all", season: null, year: null, items: programs }];
  const isAdmin = me.roles.includes("admin");
  const approvalCount = isAdmin ? await countPendingApprovals(me.orgId) : 0;

  return (
    <div className="animate-fade-up">
      <PageHeader title={title} description={t("editOps.programs.listDescription")}
        actions={<div className="flex flex-wrap gap-2">
          <Link href="/admin/discounts"><Button variant="secondary"><Percent className="h-4 w-4" /> {t("camps.discounts.title")}</Button></Link>
          {isAdmin && (approvalCount > 0 || kindFilter === "camp") && (
            <Link href="/admin/camps/approvals"><Button variant={approvalCount > 0 ? "outline" : "secondary"}><ShieldQuestion className="h-4 w-4" /> {t("camps.approval.admin.link", { count: approvalCount })}</Button></Link>
          )}
          {isAdmin && <Link href="/admin/programs/new"><Button><Plus className="h-4 w-4" /> {t("editOps.programs.new")}</Button></Link>}
        </div>} />
      <nav aria-label={t("camps.filterByType")} className="mb-4 flex flex-wrap gap-2">
        {[null, ...PROGRAM_KINDS].map((k) => (
          <Link key={k ?? "all"} href={k ? `/admin/programs?kind=${k}` : "/admin/programs"} aria-current={kindFilter === k ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs ${kindFilter === k ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-3 hover:border-maroon/40"}`}>
            {k ? t.dynamic(`programKind.${k}`, undefined, k) : t("common.all")}
          </Link>
        ))}
      </nav>
      {(kindFilter === "camp" || seasonFilter) && campSeasons.length > 0 && (
        <nav aria-label={t("camps.seasons.filter")} className="-mt-2 mb-4 flex flex-wrap gap-2">
          {[null, ...campSeasons.map((g) => g.key)].map((k) => {
            const g = campSeasons.find((x) => x.key === k);
            return (
              <Link key={k ?? "all"} href={k ? `/admin/programs?kind=camp&season=${k}` : "/admin/programs?kind=camp"} aria-current={seasonFilter === k ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-xs ${seasonFilter === k ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-3 hover:border-maroon/40"}`}>
                {g?.season ? t("camps.seasons.label", { season: t(`camps.seasons.names.${g.season}`), year: g.year ?? "" }) : t("camps.seasons.allSeasons")}
              </Link>
            );
          })}
        </nav>
      )}
      {programs.length === 0 ? (
        <EmptyState icon={<CalendarRange className="h-5 w-5" />} title={t("editOps.programs.empty")}
          description={isAdmin ? t("editOps.programs.emptyHint") : undefined} />
      ) : grouped.map((grp) => (
        <section key={grp.key} className="mb-6 space-y-3">
          {grp.key !== "all" && (
            <h2 className="font-display text-lg font-semibold text-ink">
              {grp.season ? t("camps.seasons.label", { season: t(`camps.seasons.names.${grp.season}`), year: grp.year ?? "" }) : t("camps.seasons.unscheduled")}
            </h2>
          )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {grp.items.map((p) => (
            <Card key={p.id} className={p.status === "archived" ? "opacity-60" : undefined}>
              <CardBody>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/admin/programs/${p.id}`} className="text-base font-semibold text-ink hover:text-maroon">{p.name}</Link>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Badge tone="neutral">{t.dynamic(`programKind.${p.kind}`, undefined, p.kind)}</Badge>
                    <Badge tone={TONE[p.status]}>{t.dynamic(`editOps.programs.statuses.${p.status}`, undefined, p.status)}</Badge>
                    {p.isPublic && <Badge tone="maroon">{t("editOps.programs.publicBadge")}</Badge>}
                  </div>
                </div>
                {(p.startsOn || p.location) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
                    {p.startsOn && <span>{f.dateRange(p.startsOn, p.endsOn ?? p.startsOn)}</span>}
                    {p.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.location}</span>}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between text-sm text-ink-2">
                  <span>{t("editOps.programs.capacity")} <span className="tnum">{p.capacity ? `${p.enrolled} / ${p.capacity}` : p.enrolled}</span></span>
                  <span className="tnum text-ink">{f.money(p.price, p.currency ?? f.currency)}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  {p.isPublic && p.status === "published" && p.slug
                    ? <Link href={`/register/${p.slug}`} className="text-xs text-maroon hover:underline">{t("editOps.programs.registrationPage")}</Link>
                    : <span />}
                  {isAdmin && (
                    <Link href={`/admin/programs/${p.id}/edit`} aria-label={t("editOps.programs.editNamed", { name: p.name })}>
                      <Button size="sm" variant="secondary"><Pencil className="h-4 w-4" /> {t("common.edit")}</Button>
                    </Link>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
        </section>
      ))}
    </div>
  );
}

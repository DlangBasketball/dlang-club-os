import Link from "next/link";
import { School } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getAlumniAccess, getPlacementStats } from "@/lib/alumni/data";

/**
 * Admin dashboard: where former players went (people per current placement
 * type), new placements this season and follow-ups due. Admins of clubs with
 * the alumni module (finance never); hidden while the list is empty.
 */
export async function PlacementsDashboardCard() {
  const access = await getAlumniAccess();
  if (!access?.isAdmin) return null;
  const [stats, { t, f }] = await Promise.all([getPlacementStats(access.me.orgId), getI18n()]);
  if (stats.total === 0) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><School className="h-4 w-4 text-brand-accent" aria-hidden /> {t("alumni.dashboard.title")}</CardTitle>
        <Link href="/admin/alumni" className="text-xs text-brand-primary hover:underline">{t("alumni.dashboard.open")}</Link>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><p className="eyebrow">{t("alumni.counts.total")}</p><p className="font-display text-2xl text-text">{f.number(stats.total)}</p></div>
          <div>
            <p className="eyebrow">{stats.seasonName ? t("alumni.dashboard.newSeason", { season: stats.seasonName }) : t("alumni.dashboard.new12m")}</p>
            <p className="font-display text-2xl text-success">{f.number(stats.newThisSeason)}</p>
          </div>
          {stats.followUpsDue > 0 && (
            <div>
              <p className="eyebrow">{t("alumni.counts.followUpsDue")}</p>
              <Link href="/admin/alumni?followUp=1" className="font-display text-2xl text-warning hover:underline">{f.number(stats.followUpsDue)}</Link>
            </div>
          )}
        </div>
        {stats.groups.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {stats.groups.map((g) => (
              <li key={g.key} className="rounded-full border border-border bg-surface-elevated px-3 py-1 text-text-secondary">
                <strong className="text-text">{f.number(g.count)}</strong> {t(`alumni.groups.${g.key}`)}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

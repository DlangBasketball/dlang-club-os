import Link from "next/link";
import { Pencil, Plus, Shield } from "lucide-react";
import { PageHeader, Button, Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, ErrorState, Avatar } from "@/components/ui";
import { SeasonForm } from "@/components/teams/season-form";
import { listSeasons, listTeams } from "@/lib/sportsops/data";
import { labelsFor } from "@/lib/sportsops/labels";
import { getTenant } from "@/lib/tenant/server";
import { selectClass } from "@/components/teams/fields";
import { getI18n } from "@/lib/i18n/server";

export const metadata = { title: "Teams" };

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ season?: string; all?: string }> }) {
  const LABELS = labelsFor((await getTenant()).terminology);
  const { t: tr, f } = await getI18n();
  const sp = await searchParams;
  const seasons = await listSeasons();
  if (seasons.error !== null) return <div className="animate-fade-up"><PageHeader title={LABELS.teams} /><ErrorState message={seasons.error} /></div>;
  const current = seasons.data.find((s) => s.isCurrent);
  const seasonId = sp.season === "all" ? undefined : sp.season ?? current?.id;
  const teams = await listTeams({ seasonId, includeInactive: sp.all === "1" });
  if (teams.error !== null) return <div className="animate-fade-up"><PageHeader title={LABELS.teams} /><ErrorState message={teams.error} /></div>;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={LABELS.teams} description="Squads by season, with coaches and rosters."
        actions={<Link href="/admin/teams/new"><Button size="sm"><Plus className="h-4 w-4" /> New team</Button></Link>} />

      <form className="flex flex-wrap items-center gap-3" method="get">
        <select name="season" defaultValue={sp.season ?? current?.id ?? "all"} className={`${selectClass} w-56`} aria-label="Season">
          <option value="all">All seasons</option>
          {seasons.data.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? " (current)" : ""}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="h-4 w-4 accent-[var(--red-primary)]" /> Include inactive</label>
        <Button type="submit" size="sm" variant="secondary">Filter</Button>
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {teams.data.length === 0 ? (
            <EmptyState icon={<Shield className="h-5 w-5" />} title="No teams yet"
              description={seasons.data.length ? "Create your first team and add athletes to its roster." : "Start by adding a season, then create teams."}
              action={<Link href="/admin/teams/new"><Button size="sm"><Plus className="h-4 w-4" /> New team</Button></Link>} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {teams.data.map((t) => (
                <Card key={t.id} className="h-full transition-colors hover:border-maroon" style={t.color ? { borderTop: `3px solid ${t.color}` } : undefined}>
                    <CardBody>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/admin/teams/${t.id}`} className="text-base font-semibold text-ink hover:text-maroon">{t.name}</Link>
                        <div className="flex shrink-0 items-center gap-1">
                          {!t.isActive && <Badge>inactive</Badge>}
                          <Link href={`/admin/teams/${t.id}/edit`} aria-label={tr("editOps.teams.editNamed", { name: t.name })}>
                            <Button size="sm" variant="ghost"><Pencil className="h-3.5 w-3.5" /> {tr("common.edit")}</Button>
                          </Link>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-ink-3">
                        {[t.sport, t.ageGroup, t.gender, t.level].filter(Boolean).map((x) => <Badge key={x} tone="neutral">{x}</Badge>)}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm text-ink-2">
                        <span className="flex min-w-0 items-center gap-2">
                          {t.coaches.length > 0 && (
                            <span className="flex -space-x-2">
                              {t.coaches.slice(0, 3).map((c) => <Avatar key={c.id} name={c.name} src={c.photoUrl} size="sm" className="ring-2 ring-[var(--surface)]" />)}
                            </span>
                          )}
                          <span className="truncate">{t.coaches.length ? t.coaches.map((c) => c.name).join(", ") : "No coach assigned"}</span>
                        </span>
                        <span className="tnum text-ink">{t.rosterCount} {t.rosterCount === 1 ? LABELS.athlete.toLowerCase() : LABELS.athletes.toLowerCase()}</span>
                      </div>
                      {t.seasonName && <div className="mt-1 text-xs text-ink-3">{t.seasonName}</div>}
                    </CardBody>
                  </Card>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Seasons</CardTitle></CardHeader>
            <CardBody className="space-y-4">
              {seasons.data.length === 0 && <p className="text-sm text-ink-3">No seasons yet.</p>}
              <ul className="space-y-2 text-sm">
                {seasons.data.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="text-xs text-ink-3">{f.date(s.startsOn)} – {f.date(s.endsOn)}{s.isCurrent && <Badge tone="maroon" className="ml-2">current</Badge>}</span>
                  </li>
                ))}
              </ul>
              <div className="border-t border-line-soft pt-4"><SeasonForm /></div>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

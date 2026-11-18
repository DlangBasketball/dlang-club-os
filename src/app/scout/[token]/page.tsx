import { notFound } from "next/navigation";
import { Award, GraduationCap } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { familyAdminDb } from "@/lib/family/db";
import { hashScoutToken, isScoutTokenShape } from "@/lib/family/scout";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  // Never indexed: the link is shared privately with a scout.
  return { title: t("family.scout.publicTitle"), robots: { index: false, follow: false } };
}

/**
 * Public scout profile. Only published with explicit guardian consent; shows
 * only the fields the guardian chose (never medical, contact or family data);
 * nothing once expired or revoked. The URL token is hashed before lookup.
 */
export default async function ScoutProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isScoutTokenShape(token)) notFound();
  const { data: v } = await familyAdminDb().rpc("scout_profile_view", { p_token_hash: hashScoutToken(token) });
  if (!v) notFound();
  const { t, f } = await getI18n();
  const stats = Object.entries(v.stats ?? {}).filter(([k]) => k !== "games");
  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-5 bg-bg px-4 py-10">
      <header className="space-y-1">
        {v.club && <p className="text-xs uppercase tracking-[0.14em] text-text-muted">{v.club}</p>}
        <h1 className="font-display text-3xl text-text">{v.name}</h1>
        {v.headline && <p className="text-text-secondary">{v.headline}</p>}
        <div className="flex flex-wrap gap-2 pt-1 text-sm">
          {v.birth_year && <Badge>{t("family.scout.view.born", { year: v.birth_year })}</Badge>}
          {v.position && <Badge tone="brand">{v.position}</Badge>}
          {v.dominant_hand && <Badge>{t("family.scout.view.hand", { hand: v.dominant_hand })}</Badge>}
        </div>
      </header>

      {v.teams && v.teams.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("family.scout.fieldNames.teams")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm text-text-secondary">
              {v.teams.map((tm, i) => <li key={i}>{[tm.team, tm.age_group, tm.level, tm.season].filter(Boolean).join(" · ")}</li>)}
            </ul>
          </CardBody>
        </Card>
      )}

      {(v.stats || v.attendance_pct !== undefined) && (
        <Card>
          <CardHeader><CardTitle>{t("family.scout.fieldNames.stats")}</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm text-text-secondary">
            {v.stats && <p>{t("family.scout.view.games", { count: Number(v.stats.games ?? 0) })}</p>}
            {stats.length > 0 && <p>{stats.map(([k, n]) => `${k}: ${f.number(n)}`).join(" · ")}</p>}
            {v.attendance_pct !== undefined && v.attendance_pct !== null && <p>{t("family.scout.view.attendance", { pct: f.percent(v.attendance_pct / 100, 0) })}</p>}
          </CardBody>
        </Card>
      )}

      {v.evaluations && v.evaluations.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("family.scout.fieldNames.evaluation_trend")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm text-text-secondary">
              {v.evaluations.map((e, i) => <li key={i}>{f.date(e.date)} · {f.number(e.score)}</li>)}
            </ul>
          </CardBody>
        </Card>
      )}

      {v.seasons && v.seasons.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("family.scout.view.seasons")}</CardTitle></CardHeader>
          <CardBody className="space-y-3 text-sm">
            {v.seasons.map((s, i) => (
              <div key={i} className="space-y-1">
                <p className="font-medium text-text">{s.season}</p>
                {s.comment && <p className="whitespace-pre-line text-text-secondary">{s.comment}</p>}
                {s.awards.length > 0 && <p className="flex flex-wrap items-center gap-1.5"><Award aria-hidden className="h-3.5 w-3.5 text-brand-accent" />{s.awards.map((a) => <Badge key={a} tone="accent">{a}</Badge>)}</p>}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {v.placements && v.placements.length > 0 && (
        <Card>
          <CardHeader className="flex items-center gap-2"><GraduationCap aria-hidden className="h-4 w-4 text-brand-primary" /><CardTitle>{t("family.scout.fieldNames.placements")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm text-text-secondary">
              {v.placements.map((p, i) => <li key={i}>{p.name} · {t.dynamic(`family.placement.statuses.${p.status}`, {}, p.status)}</li>)}
            </ul>
          </CardBody>
        </Card>
      )}

      <p className="text-xs text-text-muted">{t("family.scout.view.footer", { date: f.date(v.expires_at) })}</p>
    </main>
  );
}

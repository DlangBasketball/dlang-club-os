import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink, Settings2 } from "lucide-react";
import { Badge, Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getProgramStats, getReviewList, getSelectionSetup } from "@/lib/selection/data";
import { selectionDb } from "@/lib/selection/db";
import { CoachesEditor, PackagesEditor, SelectionSettings } from "@/components/selection/setup-editor";
import { DivisionsEditor } from "@/components/selection/divisions-editor";
import { getTeamPickerOptions } from "@/lib/data/player-profile";
import { ReviewBoard } from "@/components/selection/review-board";
import { RosterSection } from "@/components/selection/roster/roster-section";
import { CoachPaymentBadgeToggle, TournamentsEditor } from "@/components/selection/roster/tournaments-editor";
import { getTournaments } from "@/lib/selection/roster";
import { programDivisionLabel } from "@/lib/selection/arrangement";

const TABS = ["players", "applications", "setup"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("selection.admin.title") };
}

/**
 * One selection programme. Tabs (URL ?tab=): Players (default: the roster of
 * enrolments with fee and payment status), Applications (review), Set-up
 * (admins: divisions, packages, tournaments, coaches).
 */
export default async function SelectionProgramPage({ params, searchParams }: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { programId } = await params;
  const sp = await searchParams;
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "players";
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(programId)) notFound();
  const setup = await getSelectionSetup(me.orgId, programId);
  if (!setup) notFound();
  const isAdmin = me.roles.includes("admin");
  const db = await selectionDb();
  const setupTab = tab === "setup" && isAdmin;
  const [review, stats, teams, { data: coaches }, tournaments, { data: progRow }] = await Promise.all([
    getReviewList(programId),
    getProgramStats(programId),
    // Every team of the club (archived ones only to name a linked team), grouped in the picker.
    setupTab ? getTeamPickerOptions() : Promise.resolve([]),
    setupTab ? db.from("coaches").select("id,display_name").eq("org_id", me.orgId).order("display_name") : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    setupTab ? getTournaments(me.orgId, [programId]) : Promise.resolve({ data: [], error: null }),
    setupTab ? db.from("programs").select("*").eq("id", programId).eq("org_id", me.orgId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const p = setup.program;
  const currency = p.currency ?? f.currency;
  const s = stats.data[0];
  const divisions = setup.divisions.map((d) => ({ id: d.id, name: d.name }));
  const liveApplications: Record<string, number> = {};
  for (const r of review.data) {
    if (r.divisionId && r.status !== "declined" && r.status !== "withdrawn") liveApplications[r.divisionId] = (liveApplications[r.divisionId] ?? 0) + 1;
  }

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/selection" className="hover:underline">{t("selection.admin.title")}</Link>} title={p.name}
        description={t("selection.admin.programDescription")}
        actions={
          <>
            <Link href={`/admin/programs/${p.id}`} className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline"><Settings2 className="h-4 w-4" /> {t("selection.admin.programSettings")}</Link>
            {p.isPublic && p.slug && p.open && (
              <Link href={`/register/${p.slug}`} className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline"><ExternalLink className="h-4 w-4" /> {t("selection.admin.publicPage")}</Link>
            )}
          </>
        } />
      <div className="flex flex-wrap gap-2">
        <Badge tone={p.open ? "success" : "neutral"}>{p.open ? t("selection.admin.open") : t("selection.admin.closed")}</Badge>
        {p.requiresApproval && <Badge tone="info">{t("selection.admin.approvalRequired")}</Badge>}
        {p.allowNonMembers && <Badge tone="accent">{t("selection.admin.nonMembersWelcome")}</Badge>}
      </div>
      {s && (
        <Card><CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {([["invoiced", s.invoiced], ["collected", s.collected], ["outstanding", s.outstanding], ["sponsored", s.sponsored]] as const).map(([k, v]) => (
            <div key={k}><p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t(`selection.dashboard.${k}`)}</p><p className="font-display text-lg tnum text-text">{f.money(v, s.currency)}</p></div>
          ))}
        </CardBody></Card>
      )}

      <nav aria-label={t("roster.tabs.label")} className="flex gap-1 border-b border-border">
        {TABS.filter((k) => k !== "setup" || isAdmin).map((k) => (
          <Link key={k} href={`/admin/selection/${p.id}?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand-primary text-text" : "border-transparent text-text-muted hover:text-text"}`}>
            {t(`roster.tabs.${k}`)}
          </Link>
        ))}
      </nav>

      {tab === "players" && (
        <section className="space-y-3">
          <h2 className="font-display text-xl text-text">{t("roster.title")}</h2>
          <RosterSection orgId={me.orgId} programId={p.id} roles={me.roles}
            seasonHref="/admin/selection/{id}?tab=players" playerHrefBase="/admin/selection/{id}/players/" addHref="/admin/selection/{id}/players/new" />
        </section>
      )}

      {tab === "applications" && (
        <section className="space-y-3">
          <h2 className="font-display text-xl text-text">{t("selection.review.title")}</h2>
          {review.error ? <ErrorState message={review.error} /> : (
            <ReviewBoard entries={review.data} divisions={divisions} canOverrideDivision={isAdmin} canSponsor canEnroll={isAdmin} invoiceHref="/admin/invoices/" />
          )}
        </section>
      )}

      {setupTab && (
        <section className="space-y-4">
          <h2 className="font-display text-xl text-text">{t("selection.setup.title")}</h2>
          <SelectionSettings programId={p.id} selectionEnabled={p.selectionEnabled} requiresApproval={p.requiresApproval} allowNonMembers={p.allowNonMembers} />
          <DivisionsEditor programId={p.id} programName={p.name} divisions={setup.divisions} teams={teams} liveApplications={liveApplications} />
          <PackagesEditor programId={p.id} packages={setup.packages} currency={currency} />
          <TournamentsEditor programId={p.id} tournaments={tournaments.data}
            divisions={setup.divisions.map((d) => ({ id: d.id, label: programDivisionLabel(p.name, d.name) }))} />
          <CoachPaymentBadgeToggle programId={p.id} value={Boolean((progRow as { roster_coach_payment_status?: boolean } | null)?.roster_coach_payment_status)} />
          <CoachesEditor programId={p.id} assigned={setup.coaches} divisions={divisions}
            coaches={(coaches ?? []).map((c) => ({ id: c.id, name: c.display_name }))} />
        </section>
      )}
    </div>
  );
}

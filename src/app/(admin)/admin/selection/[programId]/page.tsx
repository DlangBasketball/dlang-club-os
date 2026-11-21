import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink, Settings2 } from "lucide-react";
import { Badge, Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getProgramStats, getReviewList, getSelectionSetup } from "@/lib/selection/data";
import { selectionDb } from "@/lib/selection/db";
import { CoachesEditor, DivisionsEditor, PackagesEditor, SelectionSettings } from "@/components/selection/setup-editor";
import { ReviewBoard } from "@/components/selection/review-board";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("selection.admin.title") };
}

/** One selection programme: applications to review, then the set-up (admins). */
export default async function SelectionProgramPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(programId)) notFound();
  const setup = await getSelectionSetup(me.orgId, programId);
  if (!setup) notFound();
  const isAdmin = me.roles.includes("admin");
  const db = await selectionDb();
  const [review, stats, { data: teams }, { data: coaches }] = await Promise.all([
    getReviewList(programId),
    getProgramStats(programId),
    isAdmin ? db.from("teams").select("id,name").eq("org_id", me.orgId).eq("is_active", true).order("name") : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    isAdmin ? db.from("coaches").select("id,display_name").eq("org_id", me.orgId).order("display_name") : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const p = setup.program;
  const currency = p.currency ?? f.currency;
  const s = stats.data[0];
  const divisions = setup.divisions.map((d) => ({ id: d.id, name: d.name }));

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

      <section className="space-y-3">
        <h2 className="font-display text-xl text-text">{t("selection.review.title")}</h2>
        {review.error ? <ErrorState message={review.error} /> : (
          <ReviewBoard entries={review.data} divisions={divisions} canOverrideDivision={isAdmin} canSponsor canEnroll={isAdmin} invoiceHref="/admin/invoices/" />
        )}
      </section>

      {isAdmin && (
        <section className="space-y-4">
          <h2 className="font-display text-xl text-text">{t("selection.setup.title")}</h2>
          <SelectionSettings programId={p.id} selectionEnabled={p.selectionEnabled} requiresApproval={p.requiresApproval} allowNonMembers={p.allowNonMembers} />
          <DivisionsEditor programId={p.id} divisions={setup.divisions} teams={teams ?? []} />
          <PackagesEditor programId={p.id} packages={setup.packages} currency={currency} />
          <CoachesEditor programId={p.id} assigned={setup.coaches} divisions={divisions}
            coaches={(coaches ?? []).map((c) => ({ id: c.id, name: c.display_name }))} />
        </section>
      )}
    </div>
  );
}

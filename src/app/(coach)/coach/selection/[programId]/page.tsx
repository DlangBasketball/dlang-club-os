import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getCoachSelectionPrograms, getReviewList, getSelectionSetup } from "@/lib/selection/data";
import { selectionDb } from "@/lib/selection/db";
import { ReviewBoard } from "@/components/selection/review-board";
import { RosterSection } from "@/components/selection/roster/roster-section";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("selection.coach.title") };
}

/** Coach app: review the applications of one programme (assigned coaches only; SQL decides). */
export default async function CoachSelectionProgramPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !/^[0-9a-f-]{36}$/i.test(programId)) notFound();
  const mine = await getCoachSelectionPrograms(me.orgId, me.id);
  const program = mine.find((p) => p.id === programId);
  if (!program) notFound();
  const [setup, review] = await Promise.all([getSelectionSetup(me.orgId, programId), getReviewList(programId)]);
  const db = await selectionDb();
  const { data: head } = await db.rpc("selection_head_coach", { p_program: programId });
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/coach/selection" className="hover:underline">{t("selection.coach.title")}</Link>} title={program.name}
        description={t("selection.coach.programDescription")} />
      {review.error ? <ErrorState message={review.error} /> : (
        <ReviewBoard entries={review.data} divisions={(setup?.divisions ?? []).map((d) => ({ id: d.id, name: d.name }))}
          canOverrideDivision={false} canSponsor={head === true} canEnroll={false} invoiceHref={null} />
      )}
      <section className="space-y-3">
        <h2 className="font-display text-xl text-text">{t("roster.title")}</h2>
        {/* Assigned coaches: their divisions, no amounts (payment badge only if the club allows it). */}
        <RosterSection orgId={me.orgId} programId={programId} roles={me.roles}
          seasonHref="/coach/selection/{id}" playerHrefBase={null} addHref={null} />
      </section>
    </div>
  );
}

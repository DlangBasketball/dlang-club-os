import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { ReviewerRequestCard } from "@/components/approvals/reviewer-request-card";
import { getSessionUser } from "@/lib/auth/get-user";
import { listClubRequestQueue } from "@/lib/approvals/data";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("approvals.coach.title") };
}

/**
 * Coach: club programme requests assigned to the coach (head coach of the
 * programme / its team). Minimal data only (name, age, programme, messages);
 * confirm, ask the family for more information, or decline.
 */
export default async function CoachApprovalsPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("coach")) redirect("/coach");
  const rows = await listClubRequestQueue("all");
  const open = rows.filter((r) => r.status === "pending" || r.status === "info_requested");
  const decided = rows.filter((r) => !open.includes(r)).slice(0, 20);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("approvals.coach.title")} description={t("approvals.coach.description")} />
      {open.length === 0
        ? <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title={t("approvals.coach.empty")} />
        : <div className="space-y-4">{open.map((r) => <ReviewerRequestCard key={r.id} r={r} t={t} f={f} admin={false} />)}</div>}
      {decided.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg text-text">{t("approvals.coach.decided")}</h2>
          {decided.map((r) => <ReviewerRequestCard key={r.id} r={r} t={t} f={f} admin={false} />)}
        </section>
      )}
    </div>
  );
}

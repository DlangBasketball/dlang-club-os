import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck, Tent } from "lucide-react";
import { Badge, Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { ReviewerRequestCard } from "@/components/approvals/reviewer-request-card";
import { getSessionUser } from "@/lib/auth/get-user";
import { getApprovalCounts, listClubRequestQueue } from "@/lib/approvals/data";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("approvals.admin.title") };
}

/**
 * Approvals hub (admins): family requests pending club approval — "Join the
 * club" memberships and club programme enrolments — plus the count of and
 * link to the camp age-approval queue (/admin/camps/approvals, unchanged).
 */
export default async function AdminApprovalsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [me, { t, f }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const view = sp.view === "decided" ? "decided" : "open";
  const [rows, counts] = await Promise.all([listClubRequestQueue(view), getApprovalCounts()]);
  const tab = (key: "open" | "decided", label: string) => (
    <Link href={key === "open" ? "/admin/approvals" : "/admin/approvals?view=decided"} aria-current={view === key ? "page" : undefined}
      className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", view === key ? "bg-brand-primary-soft text-text" : "text-text-muted hover:text-text")}>
      {label}
    </Link>
  );

  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader title={t("approvals.admin.title")} description={t("approvals.admin.description")}
        actions={<Badge tone="info">{t("approvals.admin.count", { count: counts.clubOpen + counts.clubInfoRequested })}</Badge>} />

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm text-text"><Tent className="h-4 w-4" aria-hidden />{t("approvals.admin.campQueue")}</span>
          <Link href="/admin/camps/approvals" className="text-sm text-brand-primary hover:underline">
            {t("camps.approval.admin.link", { count: counts.campOpen })}
          </Link>
        </CardBody>
      </Card>

      <nav aria-label={t("approvals.admin.tabs")} className="flex gap-1 rounded-lg border border-border bg-surface p-1">
        {tab("open", t("approvals.admin.open"))}
        {tab("decided", t("approvals.admin.decided"))}
      </nav>

      {rows.length === 0
        ? <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title={t(view === "open" ? "approvals.admin.empty" : "approvals.admin.emptyDecided")} />
        : <div className="space-y-4">{rows.map((r) => <ReviewerRequestCard key={r.id} r={r} t={t} f={f} admin />)}</div>}
    </div>
  );
}

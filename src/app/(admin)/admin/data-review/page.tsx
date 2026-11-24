import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { PageHeader, Badge, Card, CardBody, EmptyState, ErrorState } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listReviewFlags } from "@/lib/data/billing";
import { canSeeFlag, decidedInPanel, flagGroup, flagHref, type FlagGroup } from "@/lib/attendance/review-flags";
import { getReviewQueue } from "@/lib/participants/server";
import { ParticipantReviewPanel } from "@/components/participants/review-panel";
import { RefreshFlagsButton, ResolveFlagForm } from "@/components/attendance/admin/actions";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminAttendance.review.title") };
}

const GROUPS = ["all", "attendance", "billing", "people", "other"] as const;

/**
 * Data review (data_review_flags): records the system could not match
 * reliably, with a link to each record and a resolve action (resolved_by /
 * resolved_at). Attendance and roster flags are admin only; finance sees the
 * billing ones.
 */
export default async function DataReviewPage({ searchParams }: { searchParams: Promise<{ group?: string; resolved?: string }> }) {
  const me = await requireRole(["admin", "finance"]);
  const { t, f } = await getI18n();
  const sp = await searchParams;
  const roles = { admin: me.roles.includes("admin"), finance: me.roles.includes("finance") };
  const group = (GROUPS as readonly string[]).includes(sp.group ?? "") ? (sp.group as (typeof GROUPS)[number]) : "all";
  const includeResolved = sp.resolved === "1";
  const [res, queue] = await Promise.all([listReviewFlags({ includeResolved }), roles.admin ? getReviewQueue() : Promise.resolve(null)]);
  const header = (
    <PageHeader title={t("adminAttendance.review.title")} description={t("adminAttendance.review.description")}
      actions={roles.admin ? <RefreshFlagsButton /> : undefined} />
  );
  if (res.error !== null) return <div className="animate-fade-up">{header}<ErrorState message={res.error} /></div>;
  const visible = res.data.filter((x) => canSeeFlag(x.reasonCode, roles));
  const flags = visible.filter((x) => group === "all" || flagGroup(x.reasonCode) === group);
  const count = (g: FlagGroup | "all") => visible.filter((x) => !x.resolvedAt && (g === "all" || flagGroup(x.reasonCode) === g)).length;
  const href = (g: string, r = includeResolved) => `/admin/data-review?group=${g}${r ? "&resolved=1" : ""}`;

  return (
    <div className="animate-fade-up space-y-6">
      {header}
      <nav className="flex flex-wrap items-center gap-2" aria-label={t("adminAttendance.review.filterLabel")}>
        {GROUPS.filter((g) => roles.admin || (g !== "attendance" && g !== "people")).map((g) => (
          <Link key={g} href={href(g)} aria-current={group === g ? "page" : undefined}>
            <Badge tone={group === g ? "maroon" : "neutral"}>{t.dynamic(`adminAttendance.review.group.${g}`, undefined, g)} · {f.number(count(g))}</Badge>
          </Link>
        ))}
        <Link href={href(group, !includeResolved)} className="ml-auto text-xs text-brand-primary hover:underline">
          {includeResolved ? t("adminAttendance.review.hideResolved") : t("adminAttendance.review.showResolved")}
        </Link>
      </nav>

      {queue && (group === "all" || group === "people") && <ParticipantReviewPanel queue={queue} />}

      {flags.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title={t("adminAttendance.review.emptyTitle")} description={t("adminAttendance.review.emptyHint")} />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul>
              {flags.map((x) => {
                const link = flagHref(x);
                return (
                  <li key={x.id} className="flex flex-col gap-2 border-b border-border-soft px-5 py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text">{t.dynamic(`adminAttendance.review.codes.${x.reasonCode}`, undefined, x.reasonCode)}</span>
                        <Badge tone={flagGroup(x.reasonCode) === "attendance" ? "info" : "neutral"}>{t.dynamic(`adminAttendance.review.group.${flagGroup(x.reasonCode)}`, undefined, flagGroup(x.reasonCode))}</Badge>
                        {x.resolvedAt && <Badge tone="success">{t("adminAttendance.review.resolved")}</Badge>}
                      </div>
                      <p className="text-xs text-text-muted">{t.dynamic(`adminAttendance.review.hints.${x.reasonCode}`, undefined, "")}</p>
                      <p className="text-xs text-text-muted">
                        {f.dateTime(x.createdAt)}{x.originalReference ? ` · ${x.originalReference}` : ""}
                        {x.resolvedAt ? ` · ${t("adminAttendance.review.resolvedOn", { date: f.dateTime(x.resolvedAt) })}` : ""}
                        {x.resolutionNote ? ` · ${x.resolutionNote}` : ""}
                      </p>
                      {link && <Link href={link} className="text-xs text-brand-primary hover:underline">{t("adminAttendance.review.openRecord")}</Link>}
                    </div>
                    {!x.resolvedAt && !decidedInPanel(x.reasonCode) && <ResolveFlagForm flagId={x.id} />}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

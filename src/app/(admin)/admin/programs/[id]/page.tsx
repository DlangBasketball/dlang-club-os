import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil, ExternalLink } from "lucide-react";
import { PageHeader, Button, Card, CardBody, Badge, ErrorState } from "@/components/ui";
import { ProgramActions } from "@/components/admin/program-actions";
import { getSessionUser } from "@/lib/auth/get-user";
import { getProgram } from "@/lib/data/programs-admin";
import { getI18n } from "@/lib/i18n/server";
import { getCampAdmin } from "@/lib/camps/data";
import { CampEditor } from "@/components/camps/camp-editor";
import { CampSummaryView } from "@/components/camps/camp-summary";

const TONE = { draft: "warning", published: "success", archived: "neutral" } as const;

export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) redirect("/admin/programs");
  const { data: p, error } = await getProgram(me.orgId, id);
  if (error) return <div className="animate-fade-up"><PageHeader title={t("editOps.programs.title")} /><ErrorState message={error} /></div>;
  if (!p) notFound();
  const isAdmin = me.roles.includes("admin");
  const camp = p.kind === "camp" ? await getCampAdmin(me.orgId, p.id) : null;
  const money = (n: number) => f.money(n, p.currency ?? f.currency);
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-line-soft py-2 text-sm last:border-0"><span className="text-ink-3">{label}</span><span className="text-right text-ink">{value}</span></div>
  );
  const dash = t("editOps.common.none");

  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={p.name} description={t.dynamic(`programKind.${p.kind}`, undefined, p.kind)}
        actions={isAdmin ? <Link href={`/admin/programs/${p.id}/edit`}><Button size="sm"><Pencil className="h-4 w-4" /> {t("common.edit")}</Button></Link> : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[p.status]}>{t.dynamic(`editOps.programs.statuses.${p.status}`, undefined, p.status)}</Badge>
        {p.isPublic && <Badge tone="maroon">{t("editOps.programs.publicBadge")}</Badge>}
        {p.isPublic && p.status === "published" && p.slug && (
          <Link href={`/register/${p.slug}`} className="inline-flex items-center gap-1 text-xs text-maroon hover:underline"><ExternalLink className="h-3 w-3" />{t("editOps.programs.registrationPage")}</Link>
        )}
      </div>
      <Card><CardBody>
        {p.kind !== "camp" && row(t("editOps.programs.price"), <span className="tnum">{money(p.price)}</span>)}
        {row(t("editOps.programs.capacity"), <span className="tnum">{p.capacity ? `${p.enrolled} / ${p.capacity}` : p.enrolled}</span>)}
        {row(t("editOps.programs.dates"), p.startsOn ? f.dateRange(p.startsOn, p.endsOn ?? p.startsOn) : dash)}
        {row(t("editOps.programs.ageRange"), p.minAge != null || p.maxAge != null ? t("editOps.programs.ageRangeValue", { min: p.minAge ?? "–", max: p.maxAge ?? "–" }) : dash)}
        {row(t("editOps.programs.registrationWindow"), p.registrationOpensAt || p.registrationClosesAt
          ? `${p.registrationOpensAt ? f.dateTime(p.registrationOpensAt) : "…"} → ${p.registrationClosesAt ? f.dateTime(p.registrationClosesAt) : "…"}` : t("editOps.programs.alwaysOpen"))}
        {row(t("editOps.programs.schedule"), p.scheduleSummary || dash)}
        {row(t("editOps.programs.location"), p.location || dash)}
        {row(t("editOps.programs.registrations"), <span className="tnum">{p.registrations}</span>)}
        {row(t("editOps.common.lastUpdated"), f.dateTime(p.updatedAt))}
      </CardBody></Card>
      {p.description && <Card><CardBody><p className="whitespace-pre-wrap text-sm text-ink-2">{p.description}</p></CardBody></Card>}
      {camp?.error && <ErrorState message={camp.error} />}
      {camp?.data && (isAdmin
        ? <CampEditor programId={p.id} data={camp.data} currency={p.currency ?? f.currency} />
        : <CampSummaryView programId={p.id} data={camp.data} currency={p.currency ?? f.currency} />)}
      {isAdmin && <Card><CardBody><ProgramActions programId={p.id} status={p.status} registrations={p.registrations} /></CardBody></Card>}
    </div>
  );
}

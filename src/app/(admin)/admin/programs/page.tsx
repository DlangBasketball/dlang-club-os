import Link from "next/link";
import { CalendarRange, Plus, MapPin, Pencil } from "lucide-react";
import { PageHeader, Button, Card, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { listPrograms } from "@/lib/data/programs-admin";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { termOr } from "@/lib/tenant/terms";

const TONE = { draft: "warning", published: "success", archived: "neutral" } as const;

export default async function ProgramsPage() {
  const [me, tenant, { t, f }] = await Promise.all([getSessionUser(), getTenant(), getI18n()]);
  const title = termOr(tenant.terminology, "program", t("nav.programs"), { plural: true });
  if (!me?.orgId) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("editOps.common.noOrgTitle")} message={t("editOps.common.noOrg")} /></div>);
  const { data, error } = await listPrograms(me.orgId);
  if (error) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("editOps.common.loadFailed")} message={error} /></div>);
  const programs = data!;
  const isAdmin = me.roles.includes("admin");

  return (
    <div className="animate-fade-up">
      <PageHeader title={title} description={t("editOps.programs.listDescription")}
        actions={isAdmin ? <Link href="/admin/programs/new"><Button><Plus className="h-4 w-4" /> {t("editOps.programs.new")}</Button></Link> : undefined} />
      {programs.length === 0 ? (
        <EmptyState icon={<CalendarRange className="h-5 w-5" />} title={t("editOps.programs.empty")}
          description={isAdmin ? t("editOps.programs.emptyHint") : undefined} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {programs.map((p) => (
            <Card key={p.id} className={p.status === "archived" ? "opacity-60" : undefined}>
              <CardBody>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/admin/programs/${p.id}`} className="text-base font-semibold text-ink hover:text-maroon">{p.name}</Link>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Badge tone="neutral">{t.dynamic(`programKind.${p.kind}`, undefined, p.kind)}</Badge>
                    <Badge tone={TONE[p.status]}>{t.dynamic(`editOps.programs.statuses.${p.status}`, undefined, p.status)}</Badge>
                    {p.isPublic && <Badge tone="maroon">{t("editOps.programs.publicBadge")}</Badge>}
                  </div>
                </div>
                {(p.startsOn || p.location) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
                    {p.startsOn && <span>{f.dateRange(p.startsOn, p.endsOn ?? p.startsOn)}</span>}
                    {p.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.location}</span>}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between text-sm text-ink-2">
                  <span>{t("editOps.programs.capacity")} <span className="tnum">{p.capacity ? `${p.enrolled} / ${p.capacity}` : p.enrolled}</span></span>
                  <span className="tnum text-ink">{f.money(p.price, p.currency ?? f.currency)}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  {p.isPublic && p.status === "published" && p.slug
                    ? <Link href={`/register/${p.slug}`} className="text-xs text-maroon hover:underline">{t("editOps.programs.registrationPage")}</Link>
                    : <span />}
                  {isAdmin && (
                    <Link href={`/admin/programs/${p.id}/edit`} aria-label={t("editOps.programs.editNamed", { name: p.name })}>
                      <Button size="sm" variant="secondary"><Pencil className="h-4 w-4" /> {t("common.edit")}</Button>
                    </Link>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

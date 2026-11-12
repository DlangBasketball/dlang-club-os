import Link from "next/link";
import { CalendarRange, Plus, MapPin } from "lucide-react";
import { PageHeader, Button, Card, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { listPrograms } from "@/lib/data/programs-admin";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { term, termOr } from "@/lib/tenant/terms";

export default async function ProgramsPage() {
  const [me, tenant, { t, f }] = await Promise.all([getSessionUser(), getTenant(), getI18n()]);
  const title = termOr(tenant.terminology, "program", t("nav.programs"), { plural: true });
  const one = term(tenant.terminology, "program", { case: "lower" });
  if (!me?.orgId) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title="No organization" message="Your account isn't linked to a club yet." /></div>);
  const { data, error } = await listPrograms(me.orgId);
  if (error) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title="Couldn't load programs" message={error} /></div>);
  const programs = data!;
  const isAdmin = me.roles.includes("admin");

  return (
    <div className="animate-fade-up">
      <PageHeader title={title} description="Camps, teams and clinics open for registration."
        actions={isAdmin ? <Link href="/admin/programs/new"><Button><Plus className="h-4 w-4" /> New {one}</Button></Link> : undefined} />
      {programs.length === 0 ? (
        <EmptyState icon={<CalendarRange className="h-5 w-5" />} title={`No ${term(tenant.terminology, "program", { plural: true, case: "lower" })} yet`}
          description={isAdmin ? `Create your first ${one} to open registration.` : undefined} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {programs.map((p) => (
            <Card key={p.id} className={p.isActive ? undefined : "opacity-60"}>
              <CardBody>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold">{p.name}</h3>
                  <div className="flex shrink-0 gap-1">
                    <Badge tone="neutral">{t.dynamic(`programKind.${p.kind}`, undefined, p.kind)}</Badge>
                    {p.isPublic && <Badge tone="maroon">public</Badge>}
                    {!p.isActive && <Badge tone="neutral">inactive</Badge>}
                  </div>
                </div>
                {(p.startsOn || p.location) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
                    {p.startsOn && <span>{f.dateRange(p.startsOn, p.endsOn ?? p.startsOn)}</span>}
                    {p.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.location}</span>}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between text-sm text-ink-2">
                  <span>Capacity <span className="tnum">{p.capacity ? `${p.enrolled} / ${p.capacity}` : p.enrolled}</span></span>
                  <span className="tnum text-ink">{f.money(p.price)}</span>
                </div>
                {p.isPublic && p.slug && (
                  <Link href={`/register/${p.slug}`} className="mt-2 inline-block text-xs text-maroon hover:underline">Registration page</Link>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
import { PageHeader, Card, CardBody, ErrorState } from "@/components/ui";
import { ProgramForm } from "@/components/admin/program-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getProgram } from "@/lib/data/programs-admin";
import { getI18n } from "@/lib/i18n/server";
import { currencySymbol } from "@/lib/format";
import { PROGRAM_KINDS } from "@/lib/club-ops/validation";

export default async function EditProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect(`/admin/programs/${id}`);
  const { data: p, error } = await getProgram(me.orgId, id);
  if (error) return <div className="animate-fade-up"><PageHeader title={t("editOps.programs.editTitle")} /><ErrorState message={error} /></div>;
  if (!p) notFound();
  const kinds = PROGRAM_KINDS.map((k) => ({ value: k, label: t.dynamic(`programKind.${k}`, undefined, k) }));
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title={t("editOps.programs.editTitleNamed", { name: p.name })} />
      <Card><CardBody>
        <ProgramForm kinds={kinds} currencyLabel={currencySymbol(f.currency, f.locale)} programId={p.id}
          initial={{
            name: p.name, kind: p.kind, status: p.status, description: p.description ?? "", scheduleSummary: p.scheduleSummary,
            location: p.location ?? "", startsOn: p.startsOn ?? "", endsOn: p.endsOn ?? "", price: p.price, currency: p.currency ?? "",
            capacity: p.capacity, minAge: p.minAge, maxAge: p.maxAge, registrationOpensAt: p.registrationOpensAt,
            registrationClosesAt: p.registrationClosesAt, isPublic: p.isPublic,
          }} />
      </CardBody></Card>
    </div>
  );
}

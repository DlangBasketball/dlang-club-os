import { redirect } from "next/navigation";
import { PageHeader, Card, CardBody } from "@/components/ui";
import { ProgramForm } from "@/components/admin/program-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { currencySymbol } from "@/lib/format";
import { PROGRAM_KINDS } from "@/lib/club-ops/validation";

export default async function NewProgramPage() {
  const me = await getSessionUser();
  if (!me?.roles.includes("admin")) redirect("/admin/programs");
  const { t, f } = await getI18n();
  const kinds = PROGRAM_KINDS.map((k) => ({ value: k, label: t.dynamic(`programKind.${k}`, undefined, k) }));
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title={t("editOps.programs.new")} description={t("editOps.programs.newDescription")} />
      <Card><CardBody>
        <ProgramForm kinds={kinds} currencyLabel={currencySymbol(f.currency, f.locale)} />
      </CardBody></Card>
    </div>
  );
}

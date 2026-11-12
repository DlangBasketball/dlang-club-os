import { redirect } from "next/navigation";
import { PageHeader, Card, CardBody } from "@/components/ui";
import { ProgramForm } from "@/components/admin/program-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { term } from "@/lib/tenant/terms";
import { currencySymbol } from "@/lib/format";

export const metadata = { title: "New program" };

export default async function NewProgramPage() {
  const me = await getSessionUser();
  if (!me?.roles.includes("admin")) redirect("/admin/programs");
  const [tenant, { t, f }] = await Promise.all([getTenant(), getI18n()]);
  const kinds = (["camp", "recurring_team", "clinic", "tournament"] as const).map((k) => ({ value: k, label: t.dynamic(`programKind.${k}`, undefined, k) }));
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title={`New ${term(tenant.terminology, "program", { case: "lower" })}`} description="It is created active. Make it public to open online registration." />
      <Card><CardBody>
        <ProgramForm kinds={kinds} currencyLabel={currencySymbol(f.currency, f.locale)} />
      </CardBody></Card>
    </div>
  );
}

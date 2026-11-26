import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { FormsNav } from "@/components/forms/forms-nav";
import { NewFormForm } from "@/components/forms/form-builder";

export default async function NewFormPage() {
  await requireRole(["admin"]);
  const { t } = await getI18n();
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("forms.list.new")} description={t("forms.builder.newHint")} />
      <FormsNav active="forms" />
      <NewFormForm />
    </div>
  );
}

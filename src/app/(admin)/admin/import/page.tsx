import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { PageHeader, Button, Card, CardBody } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { TEMPLATE_COLUMNS, MAX_ROWS } from "@/lib/import/families";
import { REGISTRATION_COLUMNS } from "@/lib/import/registrations";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const me = await getSessionUser();
  if (!me?.roles.includes("admin")) redirect("/admin/dashboard");
  const { t } = await getI18n();

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={t("forms.import.title")}
        description={t("forms.import.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/import/template" prefetch={false}>
              <Button variant="secondary"><Download className="h-4 w-4" /> {t("forms.import.templateFamilies")}</Button>
            </Link>
            <Link href="/admin/import/template?kind=registrations" prefetch={false}>
              <Button variant="secondary"><Download className="h-4 w-4" /> {t("forms.import.templateRegistrations")}</Button>
            </Link>
          </div>
        }
      />

      <Card className="max-w-3xl">
        <CardBody className="space-y-2 text-sm text-ink-2">
          <p>{t("forms.import.helpFormats", { max: MAX_ROWS })}</p>
          <p>
            <strong className="text-ink">{t("forms.import.kindFamilies")}:</strong> {t("forms.import.helpFamilies")}{" "}
            <span className="font-mono text-xs">{TEMPLATE_COLUMNS.join(", ")}</span>
          </p>
          <p>
            <strong className="text-ink">{t("forms.import.kindRegistrations")}:</strong> {t("forms.import.helpRegistrations")}{" "}
            <span className="font-mono text-xs">{REGISTRATION_COLUMNS.join(", ")}</span>
          </p>
          <p>{t("forms.import.helpPrivacy")}</p>
        </CardBody>
      </Card>

      <ImportForm />
    </div>
  );
}

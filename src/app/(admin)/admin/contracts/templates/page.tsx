import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { Badge, Button, Card, CardBody, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listTemplates } from "@/lib/contracts/data";
import { FormsNav } from "@/components/forms/forms-nav";

export const dynamic = "force-dynamic";

export default async function ContractTemplatesPage() {
  await requireRole(["admin"]);
  const { t } = await getI18n();
  const res = await listTemplates();
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("forms.contracts.templatesTitle")} description={t("forms.contracts.templatesDescription")}
        actions={<Link href="/admin/contracts/templates/new"><Button size="sm"><Plus className="h-4 w-4" /> {t("forms.contracts.newTemplate")}</Button></Link>} />
      <FormsNav active="templates" />
      {res.error !== null ? <ErrorState title={t("forms.errors.loadFailed")} message={res.error} /> : res.data.length === 0 ? (
        <EmptyState icon={<FileText className="h-5 w-5" />} title={t("forms.contracts.noTemplates")} description={t("forms.contracts.noTemplatesHint")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {res.data.map((x) => (
            <Link key={x.id} href={`/admin/contracts/templates/${x.id}`}>
              <Card className="h-full transition hover:border-maroon/40"><CardBody className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{x.name}</span>
                  <Badge tone={x.status === "published" ? "success" : x.status === "archived" ? "neutral" : "warning"}>{t.dynamic(`forms.status.${x.status}`)}</Badge>
                </div>
                <div className="text-xs text-ink-3">
                  {[t.dynamic(`forms.activities.${x.activityType}`), t("forms.contracts.versionLabel", { version: x.version }), x.autoIssue ? t("forms.contracts.autoIssueShort") : null, t("forms.contracts.issuedCount", { count: x.contracts })].filter(Boolean).join(" · ")}
                </div>
              </CardBody></Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

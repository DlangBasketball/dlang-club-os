import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { Badge, Button, Card, CardBody, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listForms } from "@/lib/forms/data";
import { FormsNav } from "@/components/forms/forms-nav";
import { ReminderButton } from "@/components/forms/assignment-manager";

export const dynamic = "force-dynamic";

/** Admins only: forms hold medical and consent data of children (finance has no access). */
export default async function FormsPage() {
  await requireRole(["admin"]);
  const { t, f } = await getI18n();
  const res = await listForms();
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("forms.list.title")} description={t("forms.list.description")}
        actions={<><ReminderButton formId={null} /><Link href="/admin/forms/new"><Button size="sm"><Plus className="h-4 w-4" /> {t("forms.list.new")}</Button></Link></>} />
      <FormsNav active="forms" />
      {res.error !== null ? <ErrorState title={t("forms.errors.loadFailed")} message={res.error} /> : res.data.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-5 w-5" />} title={t("forms.list.empty")} description={t("forms.list.emptyHint")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {res.data.map((form) => (
            <Link key={form.id} href={`/admin/forms/${form.id}`}>
              <Card className="h-full transition hover:border-maroon/40"><CardBody className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{form.title}</span>
                  <span className="flex gap-1">
                    <Badge tone="neutral">{t.dynamic(`forms.types.${form.formType}`)}</Badge>
                    <Badge tone={form.status === "published" ? "success" : form.status === "archived" ? "neutral" : "warning"}>{t.dynamic(`forms.status.${form.status}`)}</Badge>
                  </span>
                </div>
                {form.description && <p className="line-clamp-2 text-xs text-ink-3">{form.description}</p>}
                <div className="text-xs text-ink-4">
                  {[form.version ? t("forms.list.version", { version: form.version }) : null, t("forms.list.assignments", { count: form.assignments }), t("forms.list.submissions", { count: form.submissions }), f.date(form.updatedAt)].filter(Boolean).join(" · ")}
                </div>
              </CardBody></Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

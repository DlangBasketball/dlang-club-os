import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getCompletion, getFormDetail } from "@/lib/forms/data";
import { FormsNav } from "@/components/forms/forms-nav";
import { FormBuilder } from "@/components/forms/form-builder";
import { AssignmentManager, ReminderButton } from "@/components/forms/assignment-manager";
import { CompletionTable } from "@/components/forms/completion-table";

export const dynamic = "force-dynamic";

export default async function FormDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t, f } = await getI18n();
  const [res, completion] = await Promise.all([getFormDetail(id), getCompletion({ formId: id })]);
  if (res.error !== null) return <ErrorState title={t("forms.errors.loadFailed")} message={res.error} />;
  if (!res.data) notFound();
  const form = res.data;
  return (
    <div className="animate-fade-up space-y-5">
      <Link href="/admin/forms" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("forms.list.title")}</Link>
      <PageHeader title={form.title} description={t("forms.builder.hint")}
        actions={<Link href={`/admin/forms/${id}/submissions`} className="text-sm text-maroon hover:underline">{t("forms.submissions.title")}</Link>} />
      <FormsNav active="forms" />

      <FormBuilder form={{ id: form.id, title: form.title, description: form.description, formType: form.formType, status: form.status, draft: form.draft, hasVersion: !!form.currentVersion, unpublishedChanges: form.unpublishedChanges }} />

      <Card>
        <CardHeader><CardTitle>{t("forms.assign.title")}</CardTitle></CardHeader>
        <CardBody><AssignmentManager formId={form.id} assignments={form.assignments} targets={form.targets} published={form.status === "published"} /></CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("forms.versions.title")}</CardTitle></CardHeader>
        <CardBody>
          {form.versions.length === 0 ? <p className="text-sm text-ink-3">{t("forms.versions.none")}</p> : (
            <ul className="divide-y divide-line text-sm">
              {form.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between py-2">
                  <span className="text-ink">{t("forms.list.version", { version: v.version })} {form.currentVersion?.id === v.id && <Badge tone="success">{t("forms.versions.current")}</Badge>}</span>
                  <span className="text-xs text-ink-3">{f.dateTime(v.publishedAt)} · {t("forms.list.submissions", { count: v.submissions })}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-3">{t("forms.versions.hint")}</p>
        </CardBody>
      </Card>

      {completion.error === null && completion.data.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("forms.completion.title")}</CardTitle><ReminderButton formId={form.id} /></CardHeader>
          <CardBody><CompletionTable rows={completion.data} /></CardBody>
        </Card>
      )}
    </div>
  );
}

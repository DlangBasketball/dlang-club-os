import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getFillContext } from "@/lib/forms/data";
import { FormFill } from "@/components/forms/form-fill";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** A guardian fills the CURRENT version of a form for one of their children. */
export default async function FillFormPage({ params, searchParams }: { params: Promise<{ formId: string }>; searchParams: Promise<{ athlete?: string; assignment?: string }> }) {
  await requireRole(["parent"]);
  const { formId } = await params;
  const { athlete, assignment } = await searchParams;
  if (!UUID.test(formId) || !athlete || !UUID.test(athlete)) notFound();
  const { t } = await getI18n();
  const res = await getFillContext(formId, athlete, assignment && UUID.test(assignment) ? assignment : null);
  if (res.error !== null || !res.data) notFound();
  const c = res.data;
  return (
    <div className="animate-fade-up max-w-2xl space-y-5">
      <Link href="/parent/forms" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("forms.parent.title")}</Link>
      <PageHeader title={c.title} description={t("forms.fill.for", { athlete: c.athleteName })} />
      {c.description && <p className="whitespace-pre-wrap text-sm text-ink-2">{c.description}</p>}
      <Card><CardBody>
        <FormFill ctx={{ formId: c.formId, versionId: c.versionId, definition: c.definition, athleteId: c.athleteId, assignmentId: c.assignmentId }} doneHref="/parent/forms" />
      </CardBody></Card>
    </div>
  );
}

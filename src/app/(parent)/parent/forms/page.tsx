import Link from "next/link";
import { ClipboardList, FilePen } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listSubmissions, parentFormTasks } from "@/lib/forms/data";
import { StatusBadge } from "@/components/forms/completion-table";

export const dynamic = "force-dynamic";

/** "My forms": what each child still needs (missing / expired / due soon) + what was submitted. */
export default async function ParentFormsPage() {
  await requireRole(["parent"]);
  const { t, f } = await getI18n();
  const [tasks, history] = await Promise.all([parentFormTasks(), listSubmissions()]);
  if (tasks.error !== null) return <ErrorState title={t("forms.errors.loadFailed")} message={tasks.error} />;
  const todo = tasks.data.tasks.filter((x) => x.status !== "complete");
  const done = tasks.data.tasks.filter((x) => x.status === "complete");
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={t("forms.parent.title")} description={t("forms.parent.description")}
        actions={<Link href="/parent/contracts"><Button size="sm" variant="secondary"><FilePen className="h-4 w-4" /> {t("forms.parent.contracts")}</Button></Link>} />
      {tasks.data.tasks.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-5 w-5" />} title={t("forms.parent.empty")} />
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>{t("forms.parent.todo")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {todo.length === 0 ? <p className="px-5 py-4 text-sm text-ink-3">{t("forms.parent.allDone")}</p> : (
                <ul className="divide-y divide-line-soft">
                  {todo.map((x) => (
                    <li key={`${x.formId}-${x.athleteId}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <div className="text-sm font-medium text-ink">{x.formTitle}</div>
                        <div className="text-xs text-ink-3">
                          {x.athleteName}{x.dueDate ? ` · ${t("forms.assign.dueOn", { date: f.date(x.dueDate) })}` : ""}{x.validUntil ? ` · ${t("forms.completion.validUntil", { date: f.date(x.validUntil) })}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={x.status} label={t.dynamic(`forms.completionStatus.${x.status}`)} />
                        <Link href={`/parent/forms/fill/${x.formId}?athlete=${x.athleteId}&assignment=${x.assignmentId}`}>
                          <Button size="sm">{x.status === "expiring" || x.status === "expired" ? t("forms.parent.renew") : t("forms.parent.fill")}</Button>
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {done.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t("forms.parent.done")}</CardTitle></CardHeader>
              <CardBody className="p-0">
                <ul className="divide-y divide-line-soft">
                  {done.map((x) => (
                    <li key={`${x.formId}-${x.athleteId}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="text-ink">{x.formTitle} · <span className="text-ink-3">{x.athleteName}</span></span>
                      {x.submissionId && <Link href={`/parent/forms/submissions/${x.submissionId}`} className="text-maroon hover:underline">{t("forms.completion.view")}</Link>}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}
      {history.error === null && history.data.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("forms.parent.history")}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-line-soft">
              {history.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link href={`/parent/forms/submissions/${s.id}`} className="text-ink hover:text-maroon">{s.formTitle} · {s.athleteName}</Link>
                  <span className="text-xs text-ink-3">{f.date(s.submittedAt)}{s.status === "voided" ? ` · ${t("forms.submissionStatus.voided")}` : ""}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

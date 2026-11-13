import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download } from "lucide-react";
import { Badge, Button, Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getSubmission } from "@/lib/forms/data";
import { AnswerView } from "./answer-view";
import { VoidSubmissionButton } from "./record-actions";

/** One submission (admin or guardian view; RLS decides who can read it). */
export async function SubmissionDetail({ id, base, backHref, backLabel, canVoid }: { id: string; base: string; backHref: string; backLabel: string; canVoid: boolean }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t, f } = await getI18n();
  const res = await getSubmission(id, { signUrls: true });
  if (res.error !== null) return <ErrorState title={t("forms.errors.loadFailed")} message={res.error} />;
  if (!res.data) notFound();
  const s = res.data;
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <Link href={backHref} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {backLabel}</Link>
      <PageHeader title={s.formTitle} description={t("forms.view.subtitle", { athlete: s.athleteName, date: f.dateTime(s.submittedAt) })}
        actions={<a href={`${base}/${s.id}/pdf`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><Download className="h-4 w-4" /> {t("forms.view.pdf")}</Button></a>} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={s.status === "voided" ? "danger" : "success"}>{t.dynamic(`forms.submissionStatus.${s.status}`)}</Badge>
        <Badge tone="neutral">{t("forms.list.version", { version: s.version })}</Badge>
        {s.validUntil && <Badge tone="neutral">{t("forms.completion.validUntil", { date: f.date(s.validUntil) })}</Badge>}
      </div>
      {s.status === "voided" && s.voidReason && <p className="rounded bg-danger-soft px-3 py-2 text-sm text-danger">{t("forms.view.voidedBecause", { reason: s.voidReason })}</p>}
      <Card><CardBody><AnswerView definition={s.definition} answers={s.answers} t={t} f={f} fileUrls={s.fileUrls} /></CardBody></Card>
      {canVoid && s.status !== "voided" && <VoidSubmissionButton id={s.id} />}
    </div>
  );
}

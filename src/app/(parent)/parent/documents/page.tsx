import { FileText, ShieldCheck } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { listFamilyDocuments, listFamilyConsents } from "@/lib/data/parent";
import { DocumentDownload } from "@/components/parent/document-download";
import { getI18n } from "@/lib/i18n/server";
import { athleteFilterFor } from "@/lib/participants/my-athletes";
import { filterByAthlete } from "@/lib/participants/active-athlete";
import { AthleteFilterBar } from "@/components/participants/athlete-filter-bar";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("myAthletes.pages.documents.title") };
}

/**
 * Family documents and recorded consents (RLS: the guardian's own family).
 * Default: the active athlete of the switcher (family-wide documents always
 * show); "All" lists everything.
 */
export default async function ParentDocumentsPage({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const [{ t, f }, sp] = await Promise.all([getI18n(), searchParams]);
  const [{ data: docs, error: dErr }, { data: consents }, filter] = await Promise.all([
    listFamilyDocuments(), listFamilyConsents(), athleteFilterFor(sp.athlete, { allowAll: true }),
  ]);
  if (dErr) return (<div className="animate-fade-up"><PageHeader title={t("myAthletes.pages.documents.title")} /><ErrorState title={t("myAthletes.pages.documents.loadError")} message={dErr} /></div>);
  const shownDocs = filter.mode === "all" ? docs ?? [] : (docs ?? []).filter((d) => !d.athleteId || d.athleteId === filter.athleteId);
  const shownConsents = filterByAthlete(consents ?? [], filter, (c) => c.athleteId);
  const kind = (k: string) => t.dynamic(`myAthletes.pages.documents.kinds.${k}`, undefined, t("myAthletes.pages.documents.kinds.other"));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("myAthletes.pages.documents.title")} description={t("myAthletes.pages.documents.description")} />
      <AthleteFilterBar athletes={filter.athletes} filter={filter} basePath="/parent/documents" t={t} />

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" aria-hidden /> {t("myAthletes.pages.documents.documents")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {shownDocs.length === 0 ? (
            <div className="p-5"><EmptyState icon={<FileText className="h-5 w-5" />} title={t("myAthletes.pages.documents.emptyTitle")} description={t("myAthletes.pages.documents.emptyHint")} /></div>
          ) : (
            <ul>{shownDocs.map((d) => (
              <li key={d.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                <div><div className="text-sm text-ink">{d.fileName ?? t("myAthletes.pages.documents.kinds.other")}</div><div className="text-xs text-ink-3">{d.athleteName ? `${d.athleteName} · ` : ""}{f.date(d.createdAt)}</div></div>
                <div className="flex items-center gap-2"><Badge tone="neutral">{kind(d.kind)}</Badge><DocumentDownload id={d.id} /></div>
              </li>
            ))}</ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden /> {t("myAthletes.pages.documents.consents")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {shownConsents.length === 0 ? (
            <div className="p-5 text-sm text-ink-3">{t("myAthletes.pages.documents.noConsents")}</div>
          ) : (
            <ul>{shownConsents.map((c, i) => (
              <li key={i} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                <span className="flex items-center gap-2 text-sm text-ink"><ShieldCheck className="h-4 w-4 text-success" aria-hidden />{c.title}<span className="text-xs text-ink-3">· {c.athleteName}</span></span>
                <span className="text-xs text-ink-3">{f.date(c.acceptedAt)}</span>
              </li>
            ))}</ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

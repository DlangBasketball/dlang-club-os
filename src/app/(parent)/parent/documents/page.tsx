import { FileText, ShieldCheck } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { listFamilyDocuments, listFamilyConsents } from "@/lib/data/parent";
import { DocumentDownload } from "@/components/parent/document-download";
import { getFormatter } from "@/lib/i18n/server";

const KIND_LABEL: Record<string, string> = { consent_pdf: "Consent PDF", medical: "Medical", insurance: "Insurance", photo: "Photo", other: "Document" };

export default async function ParentDocumentsPage() {
  const f = await getFormatter();
  const [{ data: docs, error: dErr }, { data: consents }] = await Promise.all([listFamilyDocuments(), listFamilyConsents()]);
  if (dErr) return (<div className="animate-fade-up"><PageHeader title="Documents" /><ErrorState title="Couldn't load documents" message={dErr} /></div>);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Documents & consents" description="Files and agreements on record for your family." />

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Documents</CardTitle></CardHeader>
        <CardBody className="p-0">
          {(docs ?? []).length === 0 ? (
            <div className="p-5"><EmptyState icon={<FileText className="h-5 w-5" />} title="No documents yet" description="Documents shared by the club will appear here." /></div>
          ) : (
            <ul>{(docs ?? []).map((d) => (
              <li key={d.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                <div><div className="text-sm text-ink">{d.fileName ?? "Document"}</div><div className="text-xs text-ink-3">{d.athleteName ? `${d.athleteName} · ` : ""}{f.date(d.createdAt)}</div></div>
                <div className="flex items-center gap-2"><Badge tone="neutral">{KIND_LABEL[d.kind] ?? d.kind}</Badge><DocumentDownload id={d.id} /></div>
              </li>
            ))}</ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Consent forms</CardTitle></CardHeader>
        <CardBody className="p-0">
          {(consents ?? []).length === 0 ? (
            <div className="p-5 text-sm text-ink-3">No consents recorded yet.</div>
          ) : (
            <ul>{(consents ?? []).map((c, i) => (
              <li key={i} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                <span className="flex items-center gap-2 text-sm text-ink"><ShieldCheck className="h-4 w-4 text-success" />{c.title}<span className="text-xs text-ink-3">· {c.athleteName}</span></span>
                <span className="text-xs text-ink-3">{f.date(c.acceptedAt)}</span>
              </li>
            ))}</ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

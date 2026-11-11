import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, DataTable, type Column } from "@/components/ui";
import { consentAudit, type Acceptance } from "@/lib/data/consents-admin";
import { formatDate } from "@/lib/utils";

export default async function ConsentAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { form, accepted, notAccepted } = await consentAudit(id);
  if (!form) notFound();

  const cols: Column<Acceptance>[] = [
    { key: "athleteName", header: "Athlete", render: (r) => r.athleteName },
    { key: "parentName", header: "Accepted by", render: (r) => r.parentName },
    { key: "version", header: "Version", render: (r) => `v${r.version}` },
    { key: "acceptedAt", header: "Date", render: (r) => formatDate(r.acceptedAt) },
    { key: "ip", header: "IP", render: (r) => <span className="tnum text-xs text-ink-3">{r.ip ?? "—"}</span> },
    { key: "snap", header: "Snapshot", render: (r) => (r.hasSnapshot ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-ink-4" />) },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <Link href="/admin/consents" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink"><ChevronLeft className="h-4 w-4" /> All consent forms</Link>
      <PageHeader title={`${form.title} — audit`} description={`Key ${form.key} · current v${form.version}`} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card><CardBody className="p-4"><div className="text-xs uppercase tracking-wide text-ink-3">Accepted</div><div className="text-2xl font-semibold text-success">{accepted.length}</div></CardBody></Card>
        <Card><CardBody className="p-4"><div className="text-xs uppercase tracking-wide text-ink-3">Not yet accepted</div><div className="text-2xl font-semibold text-warning">{notAccepted.length}</div></CardBody></Card>
        <Card><CardBody className="p-4"><div className="text-xs uppercase tracking-wide text-ink-3">Snapshots stored</div><div className="text-2xl font-semibold text-ink">{accepted.filter((a) => a.hasSnapshot).length}</div></CardBody></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Acceptances</CardTitle></CardHeader>
        <CardBody className="p-0"><DataTable columns={cols} rows={accepted} getRowKey={(_, i) => String(i)} empty="No acceptances yet." /></CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><XCircle className="h-4 w-4 text-warning" /> Athletes without acceptance ({notAccepted.length})</CardTitle></CardHeader>
        <CardBody>
          {notAccepted.length === 0 ? <p className="text-sm text-success">Everyone has accepted 🎉</p> : (
            <div className="flex flex-wrap gap-2">{notAccepted.map((n) => <Badge key={n} tone="neutral">{n}</Badge>)}</div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

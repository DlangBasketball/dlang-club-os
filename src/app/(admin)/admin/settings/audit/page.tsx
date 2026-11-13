import Link from "next/link";
import { Card, CardHeader, CardTitle, CardBody, DataTable, Badge, type Column } from "@/components/ui";
import { listAuditLogs, auditTables, type AuditEntry } from "@/lib/data/audit";
import { cn } from "@/lib/utils";
import { getFormatter } from "@/lib/i18n/server";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  const f = await getFormatter();
  const sp = await searchParams;
  const [rows, tables] = await Promise.all([listAuditLogs({ table: sp.table, limit: 150 }), auditTables()]);
  const cols: Column<AuditEntry>[] = [
    { key: "createdAt", header: "When", render: (r) => <span className="whitespace-nowrap text-ink-2">{f.date(r.createdAt)} {f.time(r.createdAt)}</span> },
    { key: "actorName", header: "Actor", render: (r) => r.actorName },
    { key: "action", header: "Action", render: (r) => <Badge tone="neutral">{r.action}</Badge> },
    { key: "targetTable", header: "Table", render: (r) => <span className="text-ink-3">{r.targetTable ?? "—"}</span> },
  ];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Audit log</CardTitle>
          <div className="flex flex-wrap gap-1">
            <Link href="/admin/settings/audit" className={cn("rounded px-2 py-1 text-xs", !sp.table ? "bg-maroon-soft text-inverse" : "text-ink-3 hover:text-ink")}>All</Link>
            {tables.map((t) => (
              <Link key={t} href={`/admin/settings/audit?table=${t}`} className={cn("rounded px-2 py-1 text-xs", sp.table === t ? "bg-maroon-soft text-inverse" : "text-ink-3 hover:text-ink")}>{t}</Link>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardBody className="p-0"><DataTable columns={cols} rows={rows} getRowKey={(r) => r.id} empty="No audit entries." /></CardBody>
    </Card>
  );
}

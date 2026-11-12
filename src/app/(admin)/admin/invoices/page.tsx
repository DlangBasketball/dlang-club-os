import Link from "next/link";
import { Receipt, Plus, Download, Landmark } from "lucide-react";
import { PageHeader, Button, DataTable, EmptyState, Badge, statusTone, ErrorState, type Column } from "@/components/ui";
import { listInvoices, type InvoiceListItem } from "@/lib/data/invoices";
import { formatDate } from "@/lib/utils";
import { getFormatter } from "@/lib/i18n/server";

const FILTERS = ["all", "draft", "sent", "partially_paid", "paid", "overdue", "cancelled"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const f = await getFormatter();
  const { status = "all" } = await searchParams;
  const { data, error } = await listInvoices(status);
  if (error) return (<div className="animate-fade-up"><PageHeader title="Invoices" /><ErrorState title="Couldn't load invoices" message={error} /></div>);
  const rows = data!;

  const columns: Column<InvoiceListItem>[] = [
    { key: "number", header: "Invoice", render: (r) => <Link href={`/admin/invoices/${r.id}`} className="tnum font-medium text-ink hover:text-maroon">{r.number}</Link> },
    { key: "familyName", header: "Family" },
    { key: "total", header: "Total", align: "right", render: (r) => <span className="tnum">{f.money(r.total)}</span> },
    { key: "balance", header: "Balance", align: "right", render: (r) => <span className="tnum">{f.money(r.balance)}</span> },
    { key: "dueDate", header: "Due", render: (r) => formatDate(r.dueDate) },
    { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge> },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Invoices"
        description="Issue, track and reconcile club invoices."
        actions={
          <div className="flex gap-2">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/admin/invoices/export"><Button variant="secondary"><Download className="h-4 w-4" /> Export CSV</Button></a>
            <Link href="/admin/invoices/reconcile"><Button variant="secondary"><Landmark className="h-4 w-4" /> Reconcile</Button></Link>
            <Link href="/admin/invoices/new"><Button><Plus className="h-4 w-4" /> New invoice</Button></Link>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f} href={`/admin/invoices?status=${f}`}
            className={`rounded-full px-3 py-1 text-xs ${status === f ? "bg-maroon text-inverse" : "bg-surface-elevated text-ink-3 hover:text-ink"}`}>
            {f.replace("_", " ")}
          </Link>
        ))}
      </div>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={<EmptyState icon={<Receipt className="h-5 w-5" />} title="No invoices" description="Create one or let registrations generate them." />} />
    </div>
  );
}

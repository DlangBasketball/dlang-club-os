import Link from "next/link";
import { Receipt, Plus, Download, Landmark, PencilLine } from "lucide-react";
import { PageHeader, Button, DataTable, EmptyState, Badge, statusTone, ErrorState, type Column } from "@/components/ui";
import { listInvoices, type InvoiceListItem } from "@/lib/data/invoices";
import { getFormatter, getTranslations } from "@/lib/i18n/server";

const FILTERS = ["all", "draft", "sent", "partially_paid", "paid", "overdue", "written_off", "cancelled"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const [f, t] = await Promise.all([getFormatter(), getTranslations()]);
  const { status = "all" } = await searchParams;
  const { data, error } = await listInvoices(status);
  if (error) return (<div className="animate-fade-up"><PageHeader title="Invoices" /><ErrorState title="Couldn't load invoices" message={error} /></div>);
  const rows = data!;
  const statusLabel = (s: string) => t.dynamic(`status.${s}`, undefined, t.dynamic(`editMoney.status.${s}`, undefined, s.replace("_", " ")));

  const columns: Column<InvoiceListItem>[] = [
    { key: "number", header: "Invoice", render: (r) => <Link href={`/admin/invoices/${r.id}`} className="tnum font-medium text-ink hover:text-maroon">{r.number}</Link> },
    { key: "familyName", header: "Family" },
    { key: "total", header: "Total", align: "right", render: (r) => <span className="tnum">{f.money(r.amountDue, r.currency)}</span> },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      render: (r) =>
        r.overpaid > 0 ? (
          <Badge tone="warning">{t("editMoney.overpay.flag", { amount: f.money(r.overpaid, r.currency) })}</Badge>
        ) : (
          <span className="tnum">{f.money(Math.max(0, r.balance), r.currency)}</span>
        ),
    },
    { key: "dueDate", header: "Due", render: (r) => f.date(r.dueDate) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className="inline-flex flex-wrap gap-1">
          <Badge tone={r.status === "written_off" ? "neutral" : statusTone(r.status)}>{statusLabel(r.status)}</Badge>
          {r.remindersPaused && <Badge tone="neutral">{t("editMoney.invoice.remindersPausedBadge")}</Badge>}
        </span>
      ),
    },
    {
      key: "id",
      header: t("editMoney.common.actions"),
      align: "right",
      render: (r) =>
        r.status === "cancelled" || r.status === "void" ? null : (
          <Link href={`/admin/invoices/${r.id}/edit`} aria-label={t("editMoney.invoice.editTitle", { number: r.number })} className="inline-flex items-center gap-1 text-xs text-maroon hover:underline">
            <PencilLine className="h-3.5 w-3.5" /> {t("editMoney.actions.edit")}
          </Link>
        ),
    },
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
        {FILTERS.map((k) => (
          <Link key={k} href={`/admin/invoices?status=${k}`}
            className={`rounded-full px-3 py-1 text-xs ${status === k ? "bg-maroon text-inverse" : "bg-surface-elevated text-ink-3 hover:text-ink"}`}>
            {k === "all" ? t("common.all") : statusLabel(k)}
          </Link>
        ))}
      </div>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={<EmptyState icon={<Receipt className="h-5 w-5" />} title="No invoices" description="Create one or let registrations generate them." />} />
    </div>
  );
}

import Link from "next/link";
import { Receipt, Plus, Download, Landmark, PencilLine, X } from "lucide-react";
import { PageHeader, Button, DataTable, EmptyState, Badge, statusTone, ErrorState, Input, type Column } from "@/components/ui";
import { Pager, pageParam } from "@/components/ui/pager";
import { findInvoices, type InvoiceListItem } from "@/lib/data/invoices";
import { getFormatter, getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { zonedDayKey } from "@/lib/staff/hours";

const FILTERS = ["all", "open", "draft", "sent", "partially_paid", "paid", "overdue", "written_off", "cancelled", "refunded"];
const UUID = /^[0-9a-f-]{36}$/i;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; family?: string; q?: string; page?: string }> }) {
  const [f, t] = await Promise.all([getFormatter(), getTranslations()]);
  const sp = await searchParams;
  const status = sp.status && FILTERS.includes(sp.status) ? sp.status : "all";
  const familyId = sp.family && UUID.test(sp.family) ? sp.family : undefined;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = pageParam(sp.page);
  const [{ data, error }, family] = await Promise.all([
    findInvoices({ status, familyId, q, page, todayKey: zonedDayKey(new Date(), f.timeZone) }),
    familyId ? (await createClient()).from("families").select("id,name").eq("id", familyId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const title = t("editMoney.invoiceList.title");
  if (error) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("editMoney.invoiceList.loadError")} message={error} /></div>);
  const { rows, hasMore } = data!;
  const statusLabel = (s: string) =>
    s === "open" ? t("editMoney.invoiceList.filterOpen") : t.dynamic(`status.${s}`, undefined, t.dynamic(`editMoney.status.${s}`, undefined, s.replace("_", " ")));
  const keep = { family: familyId, q: q || undefined };
  const filterHref = (k: string) => {
    const qs = new URLSearchParams({ status: k });
    if (familyId) qs.set("family", familyId);
    if (q) qs.set("q", q);
    return `/admin/invoices?${qs.toString()}`;
  };

  const columns: Column<InvoiceListItem>[] = [
    { key: "number", header: t("editMoney.invoiceList.colInvoice"), render: (r) => <Link href={`/admin/invoices/${r.id}`} className="tnum font-medium text-ink hover:text-maroon">{r.number}</Link> },
    { key: "familyName", header: t("editMoney.invoiceList.colFamily") },
    { key: "total", header: t("editMoney.invoiceList.colTotal"), align: "right", render: (r) => <span className="tnum">{f.money(r.amountDue, r.currency)}</span> },
    {
      key: "balance",
      header: t("editMoney.invoiceList.colBalance"),
      align: "right",
      render: (r) =>
        r.overpaid > 0 ? (
          <Badge tone="warning">{t("editMoney.overpay.flag", { amount: f.money(r.overpaid, r.currency) })}</Badge>
        ) : (
          <span className="tnum">{f.money(Math.max(0, r.balance), r.currency)}</span>
        ),
    },
    { key: "dueDate", header: t("editMoney.invoiceList.colDue"), render: (r) => f.date(r.dueDate) },
    {
      key: "status",
      header: t("editMoney.invoiceList.colStatus"),
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

  const filtered = status !== "all" || !!familyId || !!q || page > 1;
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={title}
        description={t("editMoney.invoiceList.description")}
        actions={
          <div className="flex gap-2">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/admin/invoices/export"><Button variant="secondary"><Download className="h-4 w-4" /> {t("editMoney.invoiceList.exportCsv")}</Button></a>
            <Link href="/admin/invoices/reconcile"><Button variant="secondary"><Landmark className="h-4 w-4" /> {t("editMoney.invoiceList.reconcile")}</Button></Link>
            <Link href="/admin/invoices/new"><Button><Plus className="h-4 w-4" /> {t("editMoney.invoiceList.new")}</Button></Link>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((k) => (
          <Link key={k} href={filterHref(k)}
            className={`rounded-full px-3 py-1 text-xs ${status === k ? "bg-maroon text-inverse" : "bg-surface-elevated text-ink-3 hover:text-ink"}`}>
            {k === "all" ? t("common.all") : statusLabel(k)}
          </Link>
        ))}
      </div>
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <input type="hidden" name="status" value={status} />
        {familyId && <input type="hidden" name="family" value={familyId} />}
        <Input name="q" defaultValue={q} placeholder={t("editMoney.invoiceList.searchPlaceholder")} aria-label={t("common.search")} className="w-64" />
        <Button type="submit" size="sm" variant="secondary">{t("common.search")}</Button>
        {family.data && <Badge tone="neutral">{t("editMoney.invoiceList.familyFilter", { name: family.data.name })}</Badge>}
        {(familyId || q) && (
          <Link href={`/admin/invoices?status=${status}`} className="inline-flex items-center gap-1 text-xs text-maroon hover:underline">
            <X className="h-3.5 w-3.5" /> {t("editMoney.invoiceList.clearFilters")}
          </Link>
        )}
      </form>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={filtered
          ? <EmptyState icon={<Receipt className="h-5 w-5" />} title={t("editMoney.invoiceList.noMatch")} />
          : <EmptyState icon={<Receipt className="h-5 w-5" />} title={t("editMoney.invoiceList.emptyTitle")} description={t("editMoney.invoiceList.emptyBody")} />} />
      <Pager basePath="/admin/invoices" params={{ status, ...keep }} page={page} hasMore={hasMore} />
    </div>
  );
}

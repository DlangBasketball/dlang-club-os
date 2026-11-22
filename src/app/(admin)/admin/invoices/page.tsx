import Link from "next/link";
import { Receipt, Plus, Download, Landmark, PencilLine, X } from "lucide-react";
import { PageHeader, Button, DataTable, EmptyState, Badge, statusTone, ErrorState, Input, Label, Select, type Column } from "@/components/ui";
import { FinTable } from "@/components/finance/fin-table";
import { Pager, pageParam } from "@/components/ui/pager";
import { findInvoices, type InvoiceListItem } from "@/lib/data/invoices";
import { getFormatter, getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { windowFor, zonedDayKey } from "@/lib/staff/hours";
import { getBillingEntities, getInvoiceTotalsByCategory, type CategoryTotals } from "@/lib/data/billing";
import { BILLING_ACTIVITIES, categoryLabelKey, isBillingActivity } from "@/lib/billing/activities";
import { isDay } from "@/lib/finance/params";

const FILTERS = ["all", "open", "draft", "sent", "partially_paid", "paid", "overdue", "written_off", "cancelled", "refunded"];
const UUID = /^[0-9a-f-]{36}$/i;

type SP = { status?: string; family?: string; q?: string; page?: string; category?: string; entity?: string; from?: string; to?: string };

/**
 * Finance invoice list: status chips, search by full number or prefix (e.g.
 * "DL EYBL", "DL CLUB-2026-00") or family, revenue category, issuing entity
 * and issue-date range; totals per category (public.invoice_totals_by_category).
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [f, t] = await Promise.all([getFormatter(), getTranslations()]);
  const sp = await searchParams;
  const status = sp.status && FILTERS.includes(sp.status) ? sp.status : "all";
  const familyId = sp.family && UUID.test(sp.family) ? sp.family : undefined;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = pageParam(sp.page);
  const category = isBillingActivity(sp.category) ? sp.category : undefined;
  const entityId = sp.entity && UUID.test(sp.entity) ? sp.entity : undefined;
  const from = isDay(sp.from) ? sp.from : undefined;
  const to = isDay(sp.to) && (!from || sp.to >= from) ? sp.to : undefined;
  const win = from || to ? windowFor(from ?? "1970-01-01", to ?? "9999-12-30", f.timeZone) : null;
  const enumStatus = status !== "all" && status !== "open" ? status : null;
  const [{ data, error }, family, entitiesRes, totalsRes] = await Promise.all([
    findInvoices({
      status, familyId, q, page, todayKey: zonedDayKey(new Date(), f.timeZone), category, entityId,
      issuedFrom: from && win ? win.from.toISOString() : undefined, issuedBefore: to && win ? win.to.toISOString() : undefined,
    }),
    familyId ? (await createClient()).from("families").select("id,name").eq("id", familyId).maybeSingle() : Promise.resolve({ data: null }),
    getBillingEntities(),
    getInvoiceTotalsByCategory({ from: from ?? null, to: to ?? null, entityId: entityId ?? null, status: enumStatus }),
  ]);
  const entities = entitiesRes.data?.entities ?? [];
  const totals: CategoryTotals[] = (totalsRes.data ?? []).filter((r) => !category || r.category === category);
  const title = t("editMoney.invoiceList.title");
  if (error) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("editMoney.invoiceList.loadError")} message={error} /></div>);
  const { rows, hasMore } = data!;
  const statusLabel = (s: string) =>
    s === "open" ? t("editMoney.invoiceList.filterOpen") : t.dynamic(`status.${s}`, undefined, t.dynamic(`editMoney.status.${s}`, undefined, s.replace("_", " ")));
  const keep = { family: familyId, q: q || undefined, category, entity: entityId, from, to };
  const filterHref = (k: string) => {
    const qs = new URLSearchParams({ status: k });
    for (const [key, v] of Object.entries(keep)) if (v) qs.set(key, v);
    return `/admin/invoices?${qs.toString()}`;
  };
  const categoryName = (c: string, label?: string | null) => (c === "selection" && label ? label : t(categoryLabelKey(c)));

  const columns: Column<InvoiceListItem>[] = [
    { key: "number", header: t("editMoney.invoiceList.colInvoice"), render: (r) => <Link href={`/admin/invoices/${r.id}`} className="tnum font-medium text-ink hover:text-maroon">{r.number}</Link> },
    {
      key: "category", header: t("financeReports.invoices.colCategory"),
      render: (r) => <Badge tone={r.category === "other" ? "warning" : "neutral"}>{categoryName(r.category, r.categoryLabel)}</Badge>,
    },
    { key: "entityName", header: t("financeReports.invoices.colEntity"), render: (r) => <span className="text-xs">{r.entityName ?? "—"}</span> },
    { key: "sourceLabel", header: t("financeReports.invoices.colSource"), render: (r) => <span className="line-clamp-1 text-xs">{r.sourceLabel ?? "—"}</span> },
    {
      key: "familyName", header: t("financeReports.invoices.colPayer"),
      render: (r) => (r.payerName && r.payerName !== r.familyName ? <span>{r.familyName}<span className="block text-xs text-ink-3">{r.payerName}</span></span> : r.familyName),
    },
    { key: "total", header: t("editMoney.invoiceList.colTotal"), align: "right", render: (r) => <span className="tnum">{f.money(r.amountDue, r.currency)}</span> },
    { key: "paid", header: t("financeReports.invoices.colPaid"), align: "right", render: (r) => <span className="tnum">{f.money(r.paid, r.currency)}</span> },
    {
      key: "balance",
      header: t("financeReports.invoices.colOutstanding"),
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

  const filtered = status !== "all" || !!familyId || !!q || !!category || !!entityId || !!from || !!to || page > 1;
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
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="status" value={status} />
        {familyId && <input type="hidden" name="family" value={familyId} />}
        <div>
          <Label htmlFor="inv-q">{t("common.search")}</Label>
          <Input id="inv-q" name="q" defaultValue={q} placeholder={t("financeReports.invoices.searchPlaceholder")} className="w-64" />
        </div>
        <div>
          <Label htmlFor="inv-cat">{t("financeReports.invoices.category")}</Label>
          <Select id="inv-cat" name="category" defaultValue={category ?? ""} className="w-48">
            <option value="">{t("financeReports.invoices.allCategories")}</option>
            {BILLING_ACTIVITIES.map((c) => <option key={c} value={c}>{t(categoryLabelKey(c))}</option>)}
          </Select>
        </div>
        {entities.length > 1 && (
          <div>
            <Label htmlFor="inv-ent">{t("financeReports.invoices.entity")}</Label>
            <Select id="inv-ent" name="entity" defaultValue={entityId ?? ""} className="w-48">
              <option value="">{t("financeReports.invoices.allEntities")}</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
        )}
        <div><Label htmlFor="inv-from">{t("financeReports.invoices.from")}</Label><Input id="inv-from" name="from" type="date" defaultValue={from ?? ""} className="w-40" /></div>
        <div><Label htmlFor="inv-to">{t("financeReports.invoices.to")}</Label><Input id="inv-to" name="to" type="date" defaultValue={to ?? ""} className="w-40" /></div>
        <Button type="submit" size="sm" variant="secondary">{t("common.search")}</Button>
        {family.data && <Badge tone="neutral">{t("editMoney.invoiceList.familyFilter", { name: family.data.name })}</Badge>}
        {(familyId || q || category || entityId || from || to) && (
          <Link href={`/admin/invoices?status=${status}`} className="inline-flex items-center gap-1 text-xs text-maroon hover:underline">
            <X className="h-3.5 w-3.5" /> {t("editMoney.invoiceList.clearFilters")}
          </Link>
        )}
      </form>
      <div className="mb-4">
        <FinTable
          title={t("financeReports.invoices.totalsTitle")}
          subtitle={t("financeReports.invoices.totalsSubtitle")}
          caption={t("financeReports.invoices.totalsTitle")}
          rows={totals}
          rowKey={(r) => `${r.category}|${r.currency}`}
          empty={totalsRes.error ? totalsRes.error : t("financeReports.invoices.totalsEmpty")}
          cols={[
            { key: "cat", header: t("financeReports.invoices.colCategory"), cell: (r) => (
              <Link href={`${filterHref(status).replace(/&category=[^&]*/, "")}&category=${r.category}`} className="text-ink hover:text-maroon">
                {t(categoryLabelKey(r.category))}
              </Link>
            ) },
            { key: "n", header: t("editMoney.invoiceList.colInvoice"), align: "right", cell: (r) => t("financeReports.invoices.count", { count: r.invoiceCount }) },
            { key: "inv", header: t("financeReports.invoices.invoiced"), align: "right", cell: (r) => f.money(r.invoiced, r.currency) },
            { key: "rec", header: t("financeReports.invoices.received"), align: "right", cell: (r) => f.money(r.received, r.currency) },
            { key: "out", header: t("financeReports.invoices.outstanding"), align: "right", cell: (r) => (
              <span className={r.outstanding > 0 ? "text-warning" : "text-ink-3"}>{f.money(r.outstanding, r.currency)}</span>
            ) },
          ]}
        />
      </div>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={filtered
          ? <EmptyState icon={<Receipt className="h-5 w-5" />} title={t("editMoney.invoiceList.noMatch")} />
          : <EmptyState icon={<Receipt className="h-5 w-5" />} title={t("editMoney.invoiceList.emptyTitle")} description={t("editMoney.invoiceList.emptyBody")} />} />
      <Pager basePath="/admin/invoices" params={{ status, ...keep }} page={page} hasMore={hasMore} />
    </div>
  );
}

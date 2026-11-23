import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorState, Input, Label, PageHeader } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import { FinanceNav } from "@/components/finance/finance-nav";
import { ToInvoiceTable, type ToInvoiceRow } from "@/components/booking/admin/to-invoice-table";
import { getBookingFinanceTotals, getBookingsToInvoice, getServiceCatalog } from "@/lib/booking/data";
import { getBillingEntities } from "@/lib/data/billing";
import { categoryLabelKey, type BillingActivity } from "@/lib/billing/activities";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminBooking.toInvoice.title") };
}

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Finance "To Invoice": confirmed / completed / no-show billable bookings
 * without an invoice, with a per-row (bulk-safe) "Create invoice"; and the
 * booking revenue totals per category and issuing entity
 * (invoice_totals_by_category). Received = recorded / confirmed payments only.
 */
export default async function ToInvoicePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; entity?: string }> }) {
  const [me, { t, f }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const from = DAY.test(sp.from ?? "") ? sp.from! : null;
  const to = DAY.test(sp.to ?? "") && (!from || sp.to! >= from) ? sp.to! : null;
  const entity = sp.entity && UUID.test(sp.entity) ? sp.entity : null;
  const [list, catalog, totals, entities] = await Promise.all([
    getBookingsToInvoice(200), getServiceCatalog({ includeInactive: true }),
    getBookingFinanceTotals({ from, to, entityId: entity }), getBillingEntities(),
  ]);
  const title = t("adminBooking.toInvoice.title");
  const services = catalog.data ?? [];
  const setupBlocked = new Set(services.filter((s) => s.setup_missing.length > 0).map((s) => s.id));
  // Categories booking services bill to (Private Training = "training"), with their invoice number prefix.
  const bookingCategories = new Map<string, string | null>();
  for (const s of services) if (!bookingCategories.has(s.billing_category) || s.number_prefix) bookingCategories.set(s.billing_category, s.number_prefix);
  if (bookingCategories.size === 0) bookingCategories.set("training", entities.data?.numberSeries.training?.prefix ?? null);
  const totalRows = (totals.data ?? []).filter((r) => bookingCategories.has(r.category));

  const rows: ToInvoiceRow[] = (list.data ?? []).map((b) => ({
    bookingId: b.booking_id, slotStart: b.slot_start, serviceName: b.service.name, serviceId: b.service.id,
    athleteName: `${b.athlete.first_name} ${b.athlete.last_name}`, athleteId: b.athlete.id, coachName: b.coach.display_name,
    payerName: b.payer?.name ?? null, price: b.price, currency: b.currency, setupMissing: setupBlocked.has(b.service.id),
  }));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={title} description={t("adminBooking.toInvoice.description")}
        actions={<Link href="/admin/bookings?billing=to_invoice"><Button size="sm" variant="secondary">{t("adminBooking.toInvoice.openList")}</Button></Link>} />
      <FinanceNav t={t} active="toInvoice" />

      {list.error !== null ? (
        <ErrorState title={t("adminBooking.common.loadFailed")} message={t.dynamic(`bookingWorkflow.errors.${list.error}`, undefined, t("bookingWorkflow.errors.generic"))} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-5 w-5" />} title={t("adminBooking.toInvoice.empty")} description={t("adminBooking.toInvoice.emptyHint")} />
      ) : (
        <ToInvoiceTable rows={rows} />
      )}

      <Card>
        <CardHeader><CardTitle>{t("adminBooking.toInvoice.totalsTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div><Label htmlFor="ti-from">{t("adminBooking.list.from")}</Label><Input id="ti-from" name="from" type="date" defaultValue={from ?? ""} className="w-44" /></div>
            <div><Label htmlFor="ti-to">{t("adminBooking.list.to")}</Label><Input id="ti-to" name="to" type="date" defaultValue={to ?? ""} className="w-44" /></div>
            <div><Label htmlFor="ti-ent">{t("adminBooking.detail.entity")}</Label>
              <Select id="ti-ent" name="entity" defaultValue={entity ?? ""} className="w-56">
                <option value="">{t("adminBooking.list.any")}</option>
                {(entities.data?.entities ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select></div>
            <Button type="submit" size="sm" variant="secondary" className="h-10">{t("adminBooking.list.apply")}</Button>
          </form>
          {totals.error !== null ? <ErrorState compact message={totals.error} /> : totalRows.length === 0 ? (
            <p className="text-sm text-ink-3">{t("adminBooking.toInvoice.noTotals")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">{t("adminBooking.detail.category")}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">{t("adminBooking.toInvoice.invoices")}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">{t("adminBooking.toInvoice.invoiced")}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">{t("adminBooking.toInvoice.received")}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t("adminBooking.toInvoice.outstanding")}</th>
                  </tr>
                </thead>
                <tbody>
                  {totalRows.map((r) => {
                    const prefix = bookingCategories.get(r.category);
                    return (
                      <tr key={`${r.category}-${r.currency}`} className="border-b border-border-soft last:border-0">
                        <td className="py-2 pr-4">
                          <Link href={`/admin/invoices?category=${r.category}${entity ? `&entity=${entity}` : ""}`} className="text-ink hover:text-maroon">
                            {t(categoryLabelKey(r.category as BillingActivity))}{prefix ? ` (${prefix})` : ""}
                          </Link>
                        </td>
                        <td className="tnum py-2 pr-4 text-right">{f.number(r.invoiceCount)}</td>
                        <td className="tnum py-2 pr-4 text-right">{f.money(r.invoiced, r.currency)}</td>
                        <td className="tnum py-2 pr-4 text-right">{f.money(r.received, r.currency)}</td>
                        <td className="tnum py-2 text-right font-medium">{f.money(r.outstanding, r.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-3">{t("adminBooking.toInvoice.cashHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}

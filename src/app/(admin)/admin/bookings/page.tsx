import Link from "next/link";
import { CalendarDays, ClipboardList, Plus, Receipt } from "lucide-react";
import { Badge, Button, DataTable, EmptyState, ErrorState, Input, Label, PageHeader, type Column } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import { Pager, pageParam } from "@/components/ui/pager";
import { billingTone, stateTone } from "@/components/booking/admin/tones";
import { getServiceCatalog, listBookings } from "@/lib/booking/data";
import { bookingDisplayKey } from "@/lib/booking/helpers";
import { getCoachOptions } from "@/lib/booking/admin-data";
import { BILLING_STATUSES, BOOKING_STATUSES, type BookingRow } from "@/lib/booking/types";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { addDayKey, windowFor, zonedDayKey } from "@/lib/staff/hours";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminBooking.list.title") };
}

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 50;
/** Billing filter values: the derived statuses plus "outstanding" (invoiced + partially paid). */
const BILLING_FILTERS = [...BILLING_STATUSES, "outstanding"] as const;

type SP = { view?: string; from?: string; to?: string; coach?: string; service?: string; status?: string; billing?: string; q?: string; page?: string };

/**
 * Bookings (admin / finance): today's view or a date range, filters by coach,
 * service, booking status and billing status; links to the booking, the
 * athlete and the invoice.
 */
export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireRole(["admin", "finance"]);
  const [{ t, f }, sp] = await Promise.all([getI18n(), searchParams]);
  const today = zonedDayKey(new Date(), f.timeZone);
  const view = sp.view === "today" ? "today" : "all";
  const from = view === "today" ? today : DAY.test(sp.from ?? "") ? sp.from! : undefined;
  const to = view === "today" ? today : DAY.test(sp.to ?? "") && (!from || sp.to! >= from) ? sp.to! : undefined;
  const coach = sp.coach && UUID.test(sp.coach) ? sp.coach : undefined;
  const service = sp.service && UUID.test(sp.service) ? sp.service : undefined;
  const status = (BOOKING_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const billing = (BILLING_FILTERS as readonly string[]).includes(sp.billing ?? "") ? sp.billing : undefined;
  const q = (sp.q ?? "").trim().slice(0, 80) || undefined;
  const page = pageParam(sp.page);
  const fromIso = from ? windowFor(from, from, f.timeZone).from.toISOString() : undefined;
  const toIso = to ? windowFor(to, to, f.timeZone).to.toISOString() : undefined;
  const base = { from: fromIso, to: toIso, coachId: coach, serviceId: service, status, search: q, limit: PAGE, offset: (page - 1) * PAGE };

  const [catalog, coaches, ...lists] = await Promise.all([
    getServiceCatalog({ includeInactive: true }),
    getCoachOptions(me.orgId as string),
    ...(billing === "outstanding"
      ? [listBookings({ ...base, billingStatus: "invoiced" }), listBookings({ ...base, billingStatus: "partially_paid" })]
      : [listBookings({ ...base, billingStatus: billing })]),
  ]);
  const failed = lists.find((l) => l.error !== null);
  const title = t("adminBooking.list.title");
  if (failed) {
    return <div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("adminBooking.common.loadFailed")} message={t.dynamic(`bookingWorkflow.errors.${failed.error}`, undefined, t("bookingWorkflow.errors.generic"))} /></div>;
  }
  const rows: BookingRow[] = lists.flatMap((l) => l.data?.rows ?? []).sort((a, b) => b.slot_start.localeCompare(a.slot_start));
  const total = lists.reduce((n, l) => n + (l.data?.total ?? 0), 0);
  const hasMore = page * PAGE < Math.max(...lists.map((l) => l.data?.total ?? 0));

  const keep: Record<string, string | undefined> = {
    view: view === "today" ? "today" : undefined, from: view === "today" ? undefined : from, to: view === "today" ? undefined : to,
    coach, service, status, billing, q,
  };
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/admin/bookings?${s}` : "/admin/bookings";
  };
  const money = (n: number | null | undefined, cur: string) => (n === null || n === undefined ? "—" : f.money(n, cur));

  const columns: Column<BookingRow & Record<string, unknown>>[] = [
    { key: "slot_start", header: t("adminBooking.list.appointment"), render: (b) => (
      <>
      <Link href={`/admin/bookings/${b.booking_id}`} className="block hover:text-maroon">
        <span className="block font-medium text-ink">{f.date(b.slot_start, { weekday: true })} · {f.time(b.slot_start)}{b.slot_end ? `–${f.time(b.slot_end)}` : ""}</span>
        <span className="block text-xs text-ink-3">{[b.service.name, b.location].filter(Boolean).join(" · ")}</span>
      </Link>
      {b.order_id && <Link href={`/admin/bookings/orders/${b.order_id}`} className="text-xs text-maroon hover:underline">{t("bookingOrders.list.order")}</Link>}
      </>
    ) },
    { key: "athlete", header: t("adminBooking.list.athlete"), render: (b) => (
      <Link href={`/admin/athletes/${b.athlete.id}?tab=bookings`} className="text-ink hover:text-maroon">{b.athlete.first_name} {b.athlete.last_name}</Link>
    ) },
    { key: "coach", header: t("adminBooking.list.coach"), render: (b) => b.coach.display_name },
    { key: "payer", header: t("adminBooking.list.payer"), render: (b) => b.payer ? b.payer.name : <span className="text-ink-3">{t("adminBooking.list.familyPayer")}</span> },
    { key: "invoice", header: t("adminBooking.list.invoice"), render: (b) => b.invoice
      ? <Link href={`/admin/invoices/${b.invoice.id}`} className="tnum text-maroon hover:underline">{b.invoice.number}</Link>
      : <span className="text-ink-3">—</span> },
    { key: "billing_status", header: t("adminBooking.list.payment"), render: (b) => (
      <span className="flex flex-col items-start gap-0.5">
        <Badge tone={billingTone(b.billing_status)}>{t.dynamic(`bookingWorkflow.billingStatus.${b.billing_status}`, undefined, b.billing_status)}</Badge>
        {b.invoice && b.invoice.balance > 0 && <span className="tnum text-xs text-ink-3">{t("adminBooking.list.balance", { amount: money(b.invoice.balance, b.currency) })}</span>}
        {!b.invoice && b.price !== null && b.billing_status === "to_invoice" && <span className="tnum text-xs text-ink-3">{money(b.price, b.currency)}</span>}
      </span>
    ) },
    { key: "state", header: t("adminBooking.list.status"), render: (b) => (
      <span className="flex flex-col items-start gap-0.5">
        <Badge tone={stateTone(b.state)}>{t.dynamic(`bookingWorkflow.state.${bookingDisplayKey(b)}`, undefined, b.state)}</Badge>
        {b.request?.stale && b.state === "requested" && <span className="text-xs text-warning">{t("bookingRequests.stale")}</span>}
      </span>
    ) },
  ];

  const services = catalog.data ?? [];
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={title} description={t("adminBooking.list.description")}
        actions={<div className="flex flex-wrap gap-2">
          <Link href="/admin/finance/to-invoice"><Button size="sm" variant="secondary"><Receipt className="h-4 w-4" /> {t("adminBooking.list.toInvoice")}</Button></Link>
          <Link href="/admin/bookings/new"><Button size="sm"><Plus className="h-4 w-4" /> {t("adminBooking.list.new")}</Button></Link>
        </div>} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-line p-0.5 text-xs">
          <Link href="/admin/bookings?view=today" className={cn("rounded px-3 py-1.5", view === "today" ? "bg-maroon text-inverse" : "text-ink-2 hover:text-ink")}><CalendarDays className="mr-1 inline h-3.5 w-3.5" />{t("adminBooking.list.today")}</Link>
          <Link href="/admin/bookings" className={cn("rounded px-3 py-1.5", view === "all" ? "bg-maroon text-inverse" : "text-ink-2 hover:text-ink")}>{t("adminBooking.list.all")}</Link>
        </div>
        <Link href={link({ view: undefined, from: today, to: addDayKey(today, 6), page: undefined })} className="text-xs text-maroon hover:underline">{t("adminBooking.list.next7")}</Link>
        <Link href="/admin/bookings?status=requested" aria-current={status === "requested" ? "page" : undefined}
          className={cn("text-xs hover:underline", status === "requested" ? "font-medium text-ink" : "text-maroon")}>{t("bookingRequests.filterAwaiting")}</Link>
        <span className="ml-auto text-xs text-ink-3">{t("adminBooking.list.count", { count: total })}</span>
      </div>

      <form method="get" className="grid grid-cols-2 gap-3 rounded-lg border border-line p-3 sm:grid-cols-4 lg:grid-cols-8">
        {view === "today" && <input type="hidden" name="view" value="today" />}
        <div className="col-span-2"><Label htmlFor="bf-q">{t("adminBooking.list.search")}</Label><Input id="bf-q" name="q" defaultValue={q ?? ""} placeholder={t("adminBooking.list.searchPlaceholder")} /></div>
        {view !== "today" && <>
          <div><Label htmlFor="bf-from">{t("adminBooking.list.from")}</Label><Input id="bf-from" name="from" type="date" defaultValue={from ?? ""} /></div>
          <div><Label htmlFor="bf-to">{t("adminBooking.list.to")}</Label><Input id="bf-to" name="to" type="date" defaultValue={to ?? ""} /></div>
        </>}
        <div><Label htmlFor="bf-coach">{t("adminBooking.list.coach")}</Label>
          <Select id="bf-coach" name="coach" defaultValue={coach ?? ""}><option value="">{t("adminBooking.list.any")}</option>{coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label htmlFor="bf-service">{t("adminBooking.list.service")}</Label>
          <Select id="bf-service" name="service" defaultValue={service ?? ""}><option value="">{t("adminBooking.list.any")}</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <div><Label htmlFor="bf-status">{t("adminBooking.list.status")}</Label>
          <Select id="bf-status" name="status" defaultValue={status ?? ""}><option value="">{t("adminBooking.list.any")}</option>
            {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{t.dynamic(`bookingWorkflow.state.${s === "booked" ? "confirmed" : s}`, undefined, s)}</option>)}</Select></div>
        <div><Label htmlFor="bf-billing">{t("adminBooking.list.payment")}</Label>
          <Select id="bf-billing" name="billing" defaultValue={billing ?? ""}><option value="">{t("adminBooking.list.any")}</option>
            {BILLING_FILTERS.map((s) => <option key={s} value={s}>{s === "outstanding" ? t("adminBooking.list.outstanding") : t.dynamic(`bookingWorkflow.billingStatus.${s}`, undefined, s)}</option>)}</Select></div>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-4 lg:col-span-8">
          <Button type="submit" size="sm" variant="secondary">{t("adminBooking.list.apply")}</Button>
          <Link href={view === "today" ? "/admin/bookings?view=today" : "/admin/bookings"} className="text-xs text-ink-3 hover:text-ink">{t("adminBooking.list.reset")}</Link>
        </div>
      </form>

      <DataTable columns={columns} rows={rows as (BookingRow & Record<string, unknown>)[]} getRowKey={(b) => b.booking_id} caption={title}
        empty={<EmptyState icon={<ClipboardList className="h-5 w-5" />} title={view === "today" ? t("adminBooking.list.emptyToday") : t("adminBooking.list.empty")}
          action={<Link href="/admin/bookings/new"><Button size="sm"><Plus className="h-4 w-4" /> {t("adminBooking.list.new")}</Button></Link>} />} />
      <Pager basePath="/admin/bookings" params={keep} page={page} hasMore={hasMore} />
    </div>
  );
}

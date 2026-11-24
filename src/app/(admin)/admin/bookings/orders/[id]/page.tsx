import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Badge, ErrorState, PageHeader } from "@/components/ui";
import { OrderWorkspace } from "@/components/booking/admin/order-workspace";
import { ServicePlanPanel } from "@/components/booking/service-plan-panel";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBookingOrder } from "@/lib/booking/order-data";
import { getCoachOptions, getSpaceOptions } from "@/lib/booking/admin-data";
import { policyRestoresPackage } from "@/lib/booking/helpers";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { zonedDayKey } from "@/lib/staff/hours";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("bookingOrders.detail.title") };
}

/**
 * Booking order (admin / finance): option and agreed price, players with
 * their payer and charge, dates (one shared session per date), package
 * usage, invoices per payer, payments and balance; actions: create
 * invoices, record a payment per invoice, schedule more dates, cancel or
 * reschedule one booking / player / date. docs/booking-workflow.md §13.
 */
export default async function BookingOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const me = await requireRole(["admin", "finance"]);
  const [{ t, f }, { id }, sp] = await Promise.all([getI18n(), params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await getBookingOrder(id);
  if (res.error === "ORDER_NOT_FOUND") notFound();
  const back = (
    <Link href="/admin/bookings" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" aria-hidden /> {t("adminBooking.list.title")}</Link>
  );
  if (res.error !== null) {
    return <div className="animate-fade-up">{back}<PageHeader title={t("bookingOrders.detail.title")} /><ErrorState title={t("adminBooking.common.loadFailed")} message={t.dynamic(`bookingWorkflow.errors.${res.error}`, undefined, t("bookingWorkflow.errors.generic"))} /></div>;
  }
  const d = res.data;
  const orgId = me.orgId as string;
  const db = await createClient();
  const [coaches, spaces, settingsRow, choiceRow] = await Promise.all([
    getCoachOptions(orgId), getSpaceOptions(orgId),
    db.from("app_settings").select("settings").eq("org_id", orgId).maybeSingle(),
    // Instalment choice of the order (20250420105400): not in the generated types yet.
    (db as unknown as SupabaseClient).from("booking_orders").select("instalment_count").eq("id", id).eq("org_id", orgId).maybeSingle(),
  ]);
  const chosen = Number((choiceRow.data as { instalment_count?: number } | null)?.instalment_count ?? 1);
  const booking = (((settingsRow.data as { settings?: Record<string, unknown> } | null)?.settings ?? {}).booking ?? {}) as { cancellation_hours?: number; refund_credits_on_cancel?: boolean };
  const nowIso = new Date().toISOString();
  // Which future bookings would get their package session back under the club policy (shown before cancelling).
  const restoreByPolicy = Object.fromEntries(d.dates.flatMap((x) => x.bookings.map((b) => [b.booking_id,
    policyRestoresPackage(b.starts_at, nowIso, Number(booking.cancellation_hours ?? 24), booking.refund_credits_on_cancel ?? true)])));

  const option = d.order.option_kind;
  const title = d.order.service.name;
  return (
    <div className="animate-fade-up max-w-5xl space-y-5">
      {back}
      <PageHeader title={title}
        description={t.dynamic(`bookingOrders.optionKind.${option}`, { sessions: d.order.option_sessions ?? 0 }, option)}
        actions={<div className="flex flex-wrap gap-1.5">
          <Badge tone={d.order.status === "active" ? "success" : "danger"}>{t.dynamic(`bookingOrders.status.${d.order.status}`, undefined, d.order.status)}</Badge>
          {d.totals.uninvoiced > 0 && <Badge tone="warning">{t("bookingOrders.detail.toInvoiceBadge", { amount: f.money(d.totals.uninvoiced, d.order.currency) })}</Badge>}
        </div>} />
      {sp.created === "1" && <p role="status" className="rounded-lg border border-success/30 bg-success-soft px-4 py-2.5 text-sm text-success">{t("bookingOrders.messages.created")}</p>}
      <OrderWorkspace detail={d} isAdmin={me.roles.includes("admin")} coaches={coaches} spaces={spaces}
        todayKey={zonedDayKey(new Date(), f.timeZone)} restoreByPolicy={restoreByPolicy} />
      <ServicePlanPanel orgId={orgId} chosen={chosen} invoiceHref={(x) => `/admin/invoices/${x}`}
        invoices={d.invoices.map((i) => ({ id: i.invoice_id, number: i.number, payerName: i.payer_name }))} />
    </div>
  );
}

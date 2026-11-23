import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarDays, ChevronLeft, Gift, Package } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader } from "@/components/ui";
import { BookingDetailActions, RetryDeliveryButton } from "@/components/booking/admin/booking-detail-actions";
import { RequestDecision } from "@/components/booking/request-decision";
import { billingTone, deliveryTone, stateTone } from "@/components/booking/admin/tones";
import { getBooking } from "@/lib/booking/data";
import { getCoachOptions, getSpaceOptions } from "@/lib/booking/admin-data";
import { bookingDisplayKey, canCancel, canInvoice, canReschedule, hoursWaiting, policyRestoresPackage } from "@/lib/booking/helpers";
import type { SetupMissingCode } from "@/lib/booking/types";
import { getInvoiceCategoryInfo } from "@/lib/data/billing";
import { categoryLabelKey } from "@/lib/billing/activities";
import { zonedParts } from "@/lib/club-ops/validation";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { zonedDayKey } from "@/lib/staff/hours";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminBooking.detail.title") };
}

type Preview = {
  billable?: boolean; amount?: number | null; currency?: string; category?: string; number_prefix?: string | null; number_preview?: string | null;
  billing_entity?: { id: string; name: string } | null; recipient?: { name: string | null; email: string | null } | null; setup_missing?: SetupMissingCode[];
};

/** Booking detail (admin / finance): session, billing, invoice, delivery, and the role-gated actions. */
export default async function AdminBookingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const me = await requireRole(["admin", "finance"]);
  const [{ t, f }, { id }, sp] = await Promise.all([getI18n(), params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const orgId = me.orgId as string;
  const res = await getBooking(id);
  if (res.error === "BOOKING_NOT_FOUND") notFound();
  if (res.error !== null) {
    return <div className="animate-fade-up"><PageHeader title={t("adminBooking.detail.title")} /><ErrorState title={t("adminBooking.common.loadFailed")} message={t.dynamic(`bookingWorkflow.errors.${res.error}`, undefined, t("bookingWorkflow.errors.generic"))} /></div>;
  }
  const b = res.data;
  const db = await createClient();
  const [coaches, spaces, invInfo, svcRow, settingsRow] = await Promise.all([
    getCoachOptions(orgId), getSpaceOptions(orgId),
    b.invoice ? getInvoiceCategoryInfo(b.invoice.id) : Promise.resolve(null),
    b.session
      ? (db as unknown as SupabaseClient).from("training_sessions").select("venue_space_id").eq("org_id", orgId).eq("id", b.session.id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("app_settings").select("settings").eq("org_id", orgId).maybeSingle(),
  ]);
  const preview = (b.invoice_preview ?? null) as Preview | null;
  const isAdmin = me.roles.includes("admin");
  const cur = b.currency;
  const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : f.money(n, cur));
  const zp = zonedParts(b.slot_start, f.timeZone);
  const bookingSettings = (((settingsRow.data as { settings?: Record<string, unknown> } | null)?.settings ?? {}).booking ?? {}) as { cancellation_hours?: number; refund_credits_on_cancel?: boolean };
  const restoreByPolicy = policyRestoresPackage(b.slot_start, new Date().toISOString(), Number(bookingSettings.cancellation_hours ?? 24), bookingSettings.refund_credits_on_cancel ?? true);
  const categoryLabel = t(categoryLabelKey(b.service.billing_category));
  const entityName = invInfo?.data?.entityName ?? preview?.billing_entity?.name ?? null;
  const failedDeliveries = b.notifications.filter((n) => n.status === "failed" || n.status === "no_contact").length
    + b.invoice_deliveries.filter((d) => d.status === "failed").length;

  return (
    <div className="animate-fade-up max-w-5xl space-y-5">
      <Link href="/admin/bookings" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("adminBooking.list.title")}</Link>
      <PageHeader title={b.service.name}
        description={t("adminBooking.detail.subtitle", { athlete: `${b.athlete.first_name} ${b.athlete.last_name}`, coach: b.coach.display_name })}
        actions={<div className="flex flex-wrap gap-1.5">
          <Badge tone={stateTone(b.state)}>{t.dynamic(`bookingWorkflow.state.${bookingDisplayKey(b)}`, undefined, b.state)}</Badge>
          <Badge tone={billingTone(b.billing_status)}>{t.dynamic(`bookingWorkflow.billingStatus.${b.billing_status}`, undefined, b.billing_status)}</Badge>
        </div>} />

      {b.order_id && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm text-ink-2">
          <Package className="h-4 w-4" aria-hidden /> {t("bookingOrders.detail.partOfOrder")}
          <Link href={`/admin/bookings/orders/${b.order_id}`} className="text-maroon hover:underline">{t("bookingOrders.detail.openOrder")}</Link>
        </p>
      )}
      {sp.created === "1" && <p role="status" className="rounded-lg border border-success/30 bg-success-soft px-4 py-2.5 text-sm text-success">{b.state === "requested" ? t("bookingWorkflow.messages.requested") : t("bookingWorkflow.messages.confirmed")}</p>}
      {b.request && (
        <Card>
          <CardHeader><CardTitle>{t("bookingRequests.detailTitle")}</CardTitle>
            {b.state === "requested" && <Badge tone={b.request.stale ? "warning" : "accent"}>{b.request.stale ? t("bookingRequests.stale") : t("bookingWorkflow.state.requested")}</Badge>}
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label={t("bookingRequests.source")} value={t.dynamic(`bookingRequests.sourceKind.${b.request.source ?? "staff"}`, undefined, b.request.source ?? "")} />
            <Row label={t("bookingRequests.requestedAt")} value={[f.dateTime(b.request.requested_at), b.request.requested_by_name].filter(Boolean).join(" · ")} />
            {b.state === "requested" && <Row label={t("bookingRequests.waiting")} value={t("bookingRequests.hours", { count: hoursWaiting(b.request.requested_at, new Date().toISOString()) })} />}
            {b.request.decision && (
              <Row label={t("bookingRequests.decision")} value={[t.dynamic(`bookingRequests.decisionKind.${b.request.decision}`, undefined, b.request.decision),
                b.request.decided_at ? f.dateTime(b.request.decided_at) : null, b.request.decided_by_name].filter(Boolean).join(" · ")} />
            )}
            {b.state === "requested" && (b.can_decide
              ? <div className="border-t border-line-soft pt-3"><p className="mb-2 text-ink-2">{t("bookingRequests.adminHint")}</p><RequestDecision bookingId={b.booking_id} /></div>
              : <p className="text-ink-3">{t("bookingRequests.coachDecides")}</p>)}
          </CardBody>
        </Card>
      )}
      {failedDeliveries > 0 && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" /> {t("adminBooking.detail.deliveryFailed", { count: failedDeliveries })}
        </div>
      )}
      {b.state === "cancelled" && b.invoice && b.invoice.balance > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" /> {t("adminBooking.detail.cancelledFinance", { number: b.invoice.number })}
          <Link href={`/admin/invoices/${b.invoice.id}`} className="underline">{t("adminBooking.detail.openInvoice")}</Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("adminBooking.detail.session")}</CardTitle>
            {b.session?.event_id && <Link href={`/admin/schedule/${b.session.event_id}`} className="inline-flex items-center gap-1 text-xs text-maroon hover:underline"><CalendarDays className="h-3.5 w-3.5" /> {t("adminBooking.detail.calendarEvent")}</Link>}
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label={t("adminBooking.detail.when")} value={`${f.date(b.slot_start, { weekday: true })} · ${f.time(b.slot_start)}${b.slot_end ? `–${f.time(b.slot_end)}` : ""}`} />
            <Row label={t("adminBooking.detail.timeZone")} value={f.timeZone} />
            <Row label={t("adminBooking.form.coach")} value={<Link href={`/admin/coaches/${b.coach.id}`} className="text-maroon hover:underline">{b.coach.display_name}</Link>} />
            <Row label={t("adminBooking.form.facility")} value={b.location ?? "—"} />
            <Row label={t("adminBooking.form.athlete")} value={<Link href={`/admin/athletes/${b.athlete.id}?tab=bookings`} className="text-maroon hover:underline">{b.athlete.first_name} {b.athlete.last_name}</Link>} />
            {b.session && <Row label={t("adminBooking.detail.participants")} value={t("adminBooking.detail.participantsCount", { count: b.session.participants, capacity: b.session.capacity })} />}
            {b.session?.rescheduled_from && <Row label={t("adminBooking.detail.rescheduled")} value={f.dateTime(b.session.rescheduled_from)} />}
            {b.participants.length > 1 && (
              <ul className="mt-2 space-y-1 border-t border-line-soft pt-2">
                {b.participants.map((x) => (
                  <li key={x.booking_id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/bookings/${x.booking_id}`} className={x.booking_id === b.booking_id ? "font-medium text-ink" : "text-ink-2 hover:text-maroon"}>{x.first_name} {x.last_name}</Link>
                    <Badge tone={stateTone(x.status === "booked" ? "confirmed" : x.status)}>{t.dynamic(`bookingWorkflow.state.${x.status === "booked" ? "confirmed" : x.status}`, undefined, x.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {b.notes && <p className="whitespace-pre-wrap border-t border-line-soft pt-2 text-ink-2">{b.notes}</p>}
            {b.state === "cancelled" && <Row label={t("adminBooking.detail.cancelled")} value={[b.cancelled_at ? f.dateTime(b.cancelled_at) : null, b.cancel_reason].filter(Boolean).join(" · ")} />}
            {b.attendance && <Row label={t("adminBooking.detail.attendance")} value={t.dynamic(`adminBooking.detail.sheet.${b.attendance.sheet_status}`, undefined, b.attendance.finalized_status ?? b.attendance.status ?? b.attendance.sheet_status)} />}
            {b.attendance_status && <Row label={t("bookingRequests.attendanceStatus")} value={t.dynamic(`teamAttendance.statuses.${b.attendance_status}`, undefined, b.attendance_status)} />}
            {b.absence_report && <Row label={t("bookingRequests.absenceReported")} value={`${t.dynamic(`teamAttendance.absenceCategories.${b.absence_report.reason_category}`, undefined, b.absence_report.reason_category)} · ${f.dateTime(b.absence_report.created_at)}`} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("adminBooking.detail.billing")}</CardTitle>
            {b.billing_mode === "package" && <Badge tone="accent"><Package className="h-3 w-3" /> {t("adminBooking.detail.packageCovered")}</Badge>}
            {b.billing_mode === "free" && <Badge tone="neutral"><Gift className="h-3 w-3" /> {t("adminBooking.detail.free")}</Badge>}
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label={t("adminBooking.form.billTo")} value={[b.recipient?.name, b.recipient?.email].filter(Boolean).join(" · ") || "—"} />
            {b.recipient && (b.recipient.address.street || b.recipient.address.city) && (
              <Row label={t("adminBooking.detail.address")} value={[b.recipient.address.street, [b.recipient.address.postal_code, b.recipient.address.city].filter(Boolean).join(" "), b.recipient.address.country].filter(Boolean).join(", ")} />
            )}
            <Row label={t("adminBooking.detail.price")} value={<span className="tnum">{money(b.price)}</span>} />
            {b.price_override_reason && <Row label={t("adminBooking.detail.listPrice")} value={<span className="tnum">{money(b.list_price)} · {b.price_override_reason}</span>} />}
            {Number(b.discount_total ?? 0) > 0 && <>
              <Row label={t("adminBooking.detail.listPrice")} value={<span className="tnum">{money(b.list_price)}</span>} />
              <Row label={t("bookingRequests.promo.discount")} value={<span className="tnum">−{money(b.discount_total)}{b.promo_code ? ` · ${b.promo_code}` : ""}</span>} />
            </>}
            <Row label={t("adminBooking.detail.category")} value={categoryLabel} />
            <Row label={t("adminBooking.detail.entity")} value={entityName ?? "—"} />
            {b.entitlement && <Row label={t("adminBooking.quote.package")} value={b.entitlement.restored_at ? t("adminBooking.detail.packageRestored") : t("adminBooking.quote.packageLeft", { count: Math.max(0, b.entitlement.sessions - b.entitlement.sessions_used) })} />}
            {b.invoice ? (
              <div className="space-y-2 border-t border-line-soft pt-2">
                <Row label={t("adminBooking.detail.invoice")} value={<Link href={`/admin/invoices/${b.invoice.id}`} className="font-mono text-maroon hover:underline">{b.invoice.number}</Link>} />
                <Row label={t("adminBooking.list.status")} value={<Badge tone={billingTone(b.billing_status)}>{t.dynamic(`status.${b.invoice.status}`, undefined, t.dynamic(`editMoney.status.${b.invoice.status}`, undefined, b.invoice.status))}</Badge>} />
                <Row label={t("adminBooking.detail.total")} value={<span className="tnum">{money(b.invoice.total)}</span>} />
                <Row label={t("adminBooking.detail.paid")} value={<span className="tnum">{money(b.invoice.paid)}</span>} />
                <Row label={t("adminBooking.detail.balance")} value={<span className="tnum font-medium">{money(b.invoice.balance)}</span>} />
                {b.invoice.due_date && <Row label={t("adminBooking.detail.due")} value={f.date(b.invoice.due_date)} />}
                <p className="text-xs"><Link href={`/admin/invoices/${b.invoice.id}`} className="text-maroon hover:underline">{t("adminBooking.detail.payments")}</Link></p>
              </div>
            ) : preview?.setup_missing && preview.setup_missing.length > 0 && b.billing_status === "to_invoice" ? (
              <p className="flex items-start gap-2 rounded border border-warning/30 bg-warning-soft p-2 text-xs text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("adminBooking.detail.setupBlocked")}</p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("adminBooking.detail.actions")}</CardTitle></CardHeader>
        <CardBody>
          <BookingDetailActions bookingId={b.booking_id} isAdmin={isAdmin} todayKey={zonedDayKey(new Date(), f.timeZone)}
            canInvoice={canInvoice(b) && !b.order_id} canReschedule={canReschedule(b) && b.attendance?.sheet_status !== "final"} canCancel={canCancel(b)}
            invoice={b.invoice ? { id: b.invoice.id, number: b.invoice.number, status: b.invoice.status, balance: b.invoice.balance, currency: cur } : null}
            preview={preview ? {
              amount: preview.amount ?? null, currency: preview.currency ?? cur, recipientName: preview.recipient?.name ?? null, recipientEmail: preview.recipient?.email ?? null,
              entityName: preview.billing_entity?.name ?? null, numberPreview: preview.number_preview ?? null, numberPrefix: preview.number_prefix ?? null,
              categoryLabel, setupMissing: preview.setup_missing ?? [], serviceId: b.service.id,
            } : null}
            hasEntitlement={Boolean(b.entitlement && !b.entitlement.restored_at)} restoreByPolicy={restoreByPolicy}
            isGroup={b.service.kind === "group"} serviceId={b.service.id} coachId={b.coach.id} coaches={coaches} spaces={spaces}
            slot={{ date: zp.date, time: zp.time, venueSpaceId: (svcRow.data as { venue_space_id: string | null } | null)?.venue_space_id ?? null }} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("adminBooking.detail.deliveries")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {b.notifications.length === 0 && b.invoice_deliveries.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-3">{t("adminBooking.detail.noDeliveries")}</p>
          ) : (
            <ul>
              {b.notifications.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-2.5 last:border-0 text-sm">
                  <span className="min-w-0">
                    <span className="block text-ink">{t.dynamic(`adminBooking.detail.notifyKind.${n.kind}`, undefined, n.kind)} · {t.dynamic(`adminBooking.detail.recipientKind.${n.recipient_kind}`, undefined, n.recipient_kind)}</span>
                    <span className="block truncate text-xs text-ink-3">{[n.recipient_name, n.recipient_email, n.sent_at ? f.dateTime(n.sent_at) : f.dateTime(n.created_at), n.last_error].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={deliveryTone(n.status)}>{t.dynamic(`bookingWorkflow.notificationStatus.${n.status}`, undefined, n.status)}</Badge>
                    {(n.status === "failed" || n.status === "no_contact") && <RetryDeliveryButton id={n.id} kind="notification" />}
                  </span>
                </li>
              ))}
              {b.invoice_deliveries.map((d) => (
                <li key={d.email_log_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-2.5 last:border-0 text-sm">
                  <span className="min-w-0">
                    <span className="block text-ink">{t("adminBooking.detail.invoiceEmail")}</span>
                    <span className="block truncate text-xs text-ink-3">{[d.to_email, d.sent_at ? f.dateTime(d.sent_at) : f.dateTime(d.created_at), d.error].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={deliveryTone(d.status)}>{t.dynamic(`bookingWorkflow.notificationStatus.${d.status}`, undefined, d.status)}</Badge>
                    {d.status === "failed" && <RetryDeliveryButton id={d.email_log_id} kind="invoiceEmail" />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4"><span className="text-ink-3">{label}</span><span className="text-right text-ink">{value}</span></div>;
}

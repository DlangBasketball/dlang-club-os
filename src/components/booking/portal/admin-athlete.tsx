import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardMeta, CardTitle, statusTone } from "@/components/ui";
import { attendanceTone } from "@/lib/attendance/family";
import type { BookedSessionMark } from "@/lib/booking/portal-data";
import type { BillingStatus, BookingRow } from "@/lib/booking/types";
import type { Formatter } from "@/lib/format";
import type { Translator } from "@/lib/i18n/translator";

/*
 * Admin athlete profile (admin / finance): bookings of the athlete with links
 * to the booking detail and invoice, booked-session attendance (admin), and
 * the invoices raised from bookings (Billing tab). Fed by
 * athlete_booking_history (staff only).
 */

const BILLING_TONE: Record<BillingStatus, "neutral" | "info" | "warning" | "success" | "danger" | "accent"> = {
  not_billable: "neutral", package: "accent", to_invoice: "warning", invoice_draft: "info", invoiced: "info",
  partially_paid: "warning", paid: "success", credited: "neutral",
};

function BookingTable({ rows, t, f }: { rows: BookingRow[]; t: Translator; f: Formatter }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-surface-elevated text-left text-[11px] uppercase tracking-[0.1em] text-text-muted">
          <tr>
            <th className="px-4 py-2">{t("playerBilling.bookings.date")}</th>
            <th className="px-4 py-2">{t("playerBilling.bookings.service")}</th>
            <th className="px-4 py-2">{t("bookingPortal.admin.state")}</th>
            <th className="px-4 py-2">{t("bookingPortal.admin.billing")}</th>
            <th className="px-4 py-2">{t("playerBilling.common.invoice")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.booking_id} className="border-t border-border-soft align-top">
              <td className="px-4 py-2">
                <Link href={`/admin/bookings/${b.booking_id}`} className="tnum text-text hover:text-brand-primary">
                  {f.date(b.slot_start, { weekday: true })} · {f.time(b.slot_start)}
                </Link>
                {b.session?.rescheduled_from && b.status === "booked" && (
                  <span className="block text-xs text-warning">{t("bookingPortal.movedFrom", { when: f.dateTime(b.session.rescheduled_from, "medium") })}</span>
                )}
              </td>
              <td className="px-4 py-2 text-text">
                {b.service.name}
                <span className="block text-xs text-text-muted">
                  {b.coach?.display_name}
                  {b.payer && <> · {t("bookingPortal.admin.payer", { name: b.payer.name })}</>}
                </span>
              </td>
              <td className="px-4 py-2">
                <Badge tone={statusTone(b.status)}>{t.dynamic(`bookingWorkflow.state.${b.state}`, undefined, b.state)}</Badge>
                {b.status === "cancelled" && b.cancel_reason && <span className="mt-1 block max-w-[14rem] break-words text-xs text-text-muted">{b.cancel_reason}</span>}
              </td>
              <td className="px-4 py-2">
                <Badge tone={BILLING_TONE[b.billing_status] ?? "neutral"}>{t.dynamic(`bookingWorkflow.billingStatus.${b.billing_status}`, undefined, b.billing_status)}</Badge>
                {b.price != null && <span className="mt-1 block tnum text-xs text-text-muted">{f.money(b.price, b.currency)}</span>}
              </td>
              <td className="px-4 py-2">
                {b.invoice ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/admin/invoices/${b.invoice.id}`} className="tnum text-brand-primary hover:underline">{b.invoice.number}</Link>
                    <Badge tone={statusTone(b.invoice.status)}>{t.dynamic(`status.${b.invoice.status}`, undefined, b.invoice.status)}</Badge>
                  </span>
                ) : <span className="text-text-muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bookings tab: upcoming and past bookings of the athlete, "New booking for this athlete". */
export function AthleteBookingsPanel({ athleteId, upcoming, past, error, canBook, t, f }: {
  athleteId: string; upcoming: BookingRow[]; past: BookingRow[]; error?: string | null; canBook: boolean; t: Translator; f: Formatter;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">{t("bookingPortal.admin.hint")}</p>
        {canBook && (
          <Link href={`/admin/bookings/new?athlete=${athleteId}`}>
            <Button size="sm"><Plus className="h-4 w-4" aria-hidden /> {t("bookingPortal.admin.newBooking")}</Button>
          </Link>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{t("playerBilling.errors.loadFailed")}</p>}
      <Card>
        <CardHeader><CardTitle>{t("bookingPortal.admin.upcoming")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {upcoming.length === 0 ? <p className="px-5 py-6 text-center text-sm text-text-muted">{t("bookingPortal.admin.noUpcoming")}</p>
            : <BookingTable rows={upcoming} t={t} f={f} />}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("bookingPortal.admin.history")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {past.length === 0 ? <p className="px-5 py-6 text-center text-sm text-text-muted">{t("playerBilling.bookings.empty")}</p>
            : <BookingTable rows={past} t={t} f={f} />}
        </CardBody>
      </Card>
    </div>
  );
}

/** Attendance tab: marks of the athlete on booked sessions (admin). */
export function BookedSessionAttendance({ rows, t, f }: { rows: BookedSessionMark[]; t: Translator; f: Formatter }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("bookingPortal.admin.sessionAttendance")}</CardTitle>
          <CardMeta>{t("bookingPortal.admin.sessionAttendanceHint")}</CardMeta>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {rows.length === 0 ? <p className="px-5 py-6 text-center text-sm text-text-muted">{t("bookingPortal.family.noAttendance")}</p> : (
          <ul>
            {rows.map((r) => (
              <li key={r.eventId} className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-2.5 last:border-0">
                <div className="min-w-0">
                  <Link href={`/admin/bookings/${r.bookingId}`} className="text-sm text-text hover:text-brand-primary">{r.serviceName}</Link>
                  <div className="text-xs text-text-muted">{f.dateTime(r.startsAt, "medium")}{r.coachName && <> · {r.coachName}</>}</div>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  {!r.final && <Badge tone="neutral">{t("teamAttendance.sheetStatuses.draft")}</Badge>}
                  <Badge tone={attendanceTone(r.status)}>{t.dynamic(`teamAttendance.statuses.${r.status}`, undefined, r.status)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Billing tab: the invoices raised from this athlete's bookings, linked both ways. */
export function BookingInvoicesPanel({ rows, t, f }: { rows: BookingRow[]; t: Translator; f: Formatter }) {
  const invoiced = rows.filter((b) => b.invoice);
  if (invoiced.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("bookingPortal.admin.bookingInvoices")}</CardTitle>
          <CardMeta>{t("bookingPortal.admin.bookingInvoicesHint")}</CardMeta>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <ul>
          {invoiced.map((b) => (
            <li key={b.booking_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-5 py-2.5 last:border-0">
              <div className="min-w-0">
                <Link href={`/admin/invoices/${b.invoice!.id}`} className="tnum text-sm text-brand-primary hover:underline">{b.invoice!.number}</Link>
                <div className="text-xs text-text-muted">
                  <Link href={`/admin/bookings/${b.booking_id}`} className="hover:text-text">{b.service.name} · {f.dateTime(b.slot_start, "medium")}</Link>
                </div>
              </div>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                <span className="tnum text-sm text-text">{f.money(b.invoice!.total, b.currency)}</span>
                {b.invoice!.balance > 0 && <span className="tnum text-xs text-warning">{t("bookingPortal.family.open", { amount: f.money(b.invoice!.balance, b.currency) })}</span>}
                <Badge tone={BILLING_TONE[b.billing_status] ?? "neutral"}>{t.dynamic(`bookingWorkflow.billingStatus.${b.billing_status}`, undefined, b.billing_status)}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

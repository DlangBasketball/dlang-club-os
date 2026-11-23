import Link from "next/link";
import { CalendarClock, ChevronRight, MapPin, Receipt, UserRound } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardMeta, CardTitle, EmptyState, statusTone } from "@/components/ui";
import { attendanceTone } from "@/lib/attendance/family";
import { changeLabel, upcomingStateKey, type PortalAttendance, type PortalChange, type PortalInvoice, type PortalUpcoming } from "@/lib/booking/portal";
import { attendancePortalPath } from "@/lib/attendance/types";
import { WithdrawRequestButton } from "@/components/booking/request-decision";
import type { Formatter } from "@/lib/format";
import type { Translator } from "@/lib/i18n/translator";

/*
 * Parent / player portal sections for booked training sessions (server
 * components). They render only what guardian_booking_overview /
 * player_booking_overview return for the viewer's own child(ren) or self:
 * service, time (club time zone), coach, place, schedule changes, finalized
 * attendance and — parents only — invoices where they are the payer.
 */

type Base = { t: Translator; f: Formatter; showChild: boolean };

function childName(a: { first_name: string; last_name: string }) {
  return `${a.first_name} ${a.last_name}`.trim();
}

/** Upcoming bookings, soonest first; a moved booking shows where it came from. */
export function UpcomingBookings({ rows, t, f, showChild, detailHref, invoiceFor, familyActions = false }: Base & {
  rows: PortalUpcoming[];
  /** Parents: withdraw an own request, report an absence (record page). */
  familyActions?: boolean;
  /** Detail page of a booking (parents); players get no link. */
  detailHref?: (bookingId: string) => string;
  invoiceFor?: (bookingId: string) => PortalInvoice | undefined;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("bookingPortal.family.upcoming")}</CardTitle>
          <CardMeta>{t("bookingPortal.family.timesHint")}</CardMeta>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<CalendarClock className="h-5 w-5" />} title={t("bookingPortal.family.noUpcoming")} description={t("bookingPortal.family.noUpcomingHint")} />
          </div>
        ) : (
          <ul>
            {rows.map((b) => {
              const invoice = invoiceFor?.(b.booking_id);
              const stateKey = upcomingStateKey(b);
              const awaiting = stateKey === "requested";
              const inner = (
                <>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">{b.service_name}</div>
                    <div className="text-sm text-text-secondary">
                      {f.date(b.starts_at, { weekday: true })} · {f.time(b.starts_at)}{b.ends_at ? `–${f.time(b.ends_at)}` : ""}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-muted">
                      {showChild && <span>{childName(b.athlete)}</span>}
                      {b.coach_name && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" aria-hidden />{b.coach_name}</span>}
                      {b.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{b.location}</span>}
                    </div>
                    {b.rescheduled_from && (
                      <div className="mt-1 text-xs text-warning">{t("bookingPortal.movedFrom", { when: f.dateTime(b.rescheduled_from, "medium") })}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <Badge tone={awaiting ? "warning" : "success"}>{t(`bookingWorkflow.state.${stateKey}`)}</Badge>
                    {b.absence_report && <Badge tone="info">{t("bookingRequests.family.absenceReported")}</Badge>}
                    {invoice && <Badge tone={statusTone(invoice.status)}>{invoice.number}</Badge>}
                    {detailHref && <ChevronRight className="h-4 w-4 text-text-subtle" aria-hidden />}
                  </div>
                </>
              );
              return (
                <li key={b.booking_id} id={`booking-${b.booking_id}`}
                    className={awaiting ? "border-b border-dashed border-warning/50 bg-warning-soft/30 last:border-0" : "border-b border-border last:border-0"}>
                  {detailHref ? (
                    <Link href={detailHref(b.booking_id)}
                      className="flex items-start justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-none">
                      {inner}
                    </Link>
                  ) : <div className="flex items-start justify-between gap-3 px-5 py-3">{inner}</div>}
                  {awaiting && <p className="px-5 pb-2 text-xs text-text-muted">{t("bookingRequests.family.awaitingHint")}</p>}
                  {familyActions && (b.can_withdraw || (b.can_report_absence && b.event_id)) && (
                    <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
                      {b.can_withdraw && <WithdrawRequestButton bookingId={b.booking_id} />}
                      {b.can_report_absence && b.event_id && (
                        <Link href={attendancePortalPath(b.event_id, b.athlete.id)} className="text-xs text-brand-primary hover:underline">
                          {b.absence_report ? t("bookingRequests.family.changeAbsence") : t("bookingRequests.family.reportAbsence")}
                        </Link>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Moved / cancelled bookings of the last 30 days, with the reason when the club gave one. */
export function BookingChanges({ rows, t, f, showChild }: Base & { rows: PortalChange[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("bookingPortal.family.changes")}</CardTitle>
          <CardMeta>{t("bookingPortal.family.changesHint")}</CardMeta>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <ul>
          {rows.map((c) => {
            const l = changeLabel(c);
            const label = l.key === "declinedReason" ? t("bookingRequests.family.declinedReason", { reason: l.reason ?? "" })
              : l.key === "declined" ? t("bookingRequests.family.declined")
              : l.key === "withdrawn" ? t("bookingRequests.family.withdrawn")
              : l.key === "cancelledReason" ? t("bookingPortal.family.cancelledReason", { reason: l.reason ?? "" })
              : l.key === "cancelled" ? t("bookingPortal.family.cancelled")
              : l.key === "movedFrom" ? t("bookingPortal.family.movedFromTo", { before: f.dateTime(l.previous ?? c.starts_at, "medium"), when: f.dateTime(c.starts_at, "medium") })
              : t("bookingPortal.family.movedTo", { when: f.dateTime(c.starts_at, "medium") });
            const cancelled = c.change !== "rescheduled";
            return (
              <li key={`${c.booking_id}-${c.change}`} className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-5 py-3 last:border-0">
                <div className="min-w-0">
                  <div className={cancelled ? "text-sm text-text-muted line-through" : "text-sm text-text"}>
                    {c.service_name} · {f.dateTime(c.starts_at, "medium")}
                  </div>
                  <div className="text-xs text-text-muted">
                    {showChild && <>{childName(c.athlete)} · </>}
                    {c.coach_name && <>{c.coach_name} · </>}
                    {c.at ? t("bookingPortal.family.changedOn", { date: f.date(c.at) }) : null}
                  </div>
                  <div className={cancelled ? "mt-1 break-words text-xs text-danger" : "mt-1 text-xs text-warning"}>{label}</div>
                </div>
                <Badge tone={cancelled ? "danger" : "warning"}>
                  {c.change === "declined" ? t("bookingRequests.decisionKind.declined") : c.change === "withdrawn" ? t("bookingRequests.decisionKind.withdrawn")
                    : cancelled ? t("bookingWorkflow.state.cancelled") : t("bookingPortal.family.moved")}
                </Badge>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Finalized attendance of booked sessions (newest first). */
export function BookedAttendance({ rows, t, f, showChild, limit = 20 }: Base & { rows: PortalAttendance[]; limit?: number }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("bookingPortal.family.attendance")}</CardTitle>
          <CardMeta>{t("bookingPortal.family.attendanceHint")}</CardMeta>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {rows.length === 0 ? <p className="px-5 py-6 text-sm text-text-muted">{t("bookingPortal.family.noAttendance")}</p> : (
          <ul>
            {rows.slice(0, limit).map((a) => (
              <li key={`${a.event_id}-${a.athlete.id}`} className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm text-text">{a.service_name}</div>
                  <div className="text-xs text-text-muted">
                    {f.dateTime(a.starts_at, "medium")}
                    {showChild && <> · {childName(a.athlete)}</>}
                    {a.coach_name && <> · {a.coach_name}</>}
                  </div>
                </div>
                <Badge tone={attendanceTone(a.status)}>{t.dynamic(`teamAttendance.statuses.${a.status}`, undefined, a.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Invoices of bookings the guardian pays (the RPC already leaves out the others). */
export function BookingInvoices({ rows, t, f, showChild }: Base & { rows: PortalInvoice[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("bookingPortal.family.invoices")}</CardTitle>
          <CardMeta>{t("bookingPortal.family.invoicesHint")}</CardMeta>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <ul>
          {rows.map((i) => (
            <li key={i.invoice_id} className="border-b border-border last:border-0">
              <Link href={`/parent/invoices/${i.invoice_id}`}
                className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-none">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm text-text"><Receipt className="h-3.5 w-3.5 text-text-muted" aria-hidden />{i.number}</div>
                  <div className="text-xs text-text-muted">
                    {t("bookingPortal.family.invoiceFor", { service: i.service_name, date: i.starts_at ? f.date(i.starts_at) : "—" })}
                    {showChild && <> · {childName(i.athlete)}</>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="tnum text-sm text-text">{f.money(i.total, i.currency)}</span>
                  {i.balance > 0 && !["paid", "cancelled", "void"].includes(i.status)
                    ? <span className="tnum text-xs text-warning">{t("bookingPortal.family.open", { amount: f.money(i.balance, i.currency) })}</span>
                    : <Badge tone={statusTone(i.status)}>{t.dynamic(`status.${i.status}`, undefined, i.status)}</Badge>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

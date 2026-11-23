import Link from "next/link";
import { CalendarCheck2, CalendarDays, FileText, Hourglass, Plus, Wallet } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, StatCard } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { hasFeature } from "@/lib/upgrades/server";
import { getBookingDashboardCounts, getBookingFollowups } from "@/lib/booking/data";

/*
 * Bookings on the admin dashboard (admin / finance, clubs with the bookings
 * module): today's bookings, awaiting invoice, outstanding booking invoices
 * and delivery follow-ups — each tile links to the filtered screen.
 */
export async function BookingDashboardCard() {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) return null;
  if (!(await hasFeature(me.orgId, "bookings"))) return null;
  const [{ t, f }, counts, followups] = await Promise.all([getI18n(), getBookingDashboardCounts(), getBookingFollowups(5)]);
  if (counts.error !== null) return null;
  const c = counts.data;
  const outstanding = c.outstanding.length
    ? c.outstanding.map((o) => f.money(o.amount, o.currency)).join(" · ")
    : f.money(0);
  const outstandingCount = c.outstanding.reduce((n, o) => n + o.count, 0);
  const notifs = (followups.data?.notifications ?? []) as { id: string; booking_id: string; athlete_name?: string; status: string; kind: string; starts_at?: string }[];
  const emails = (followups.data?.invoice_emails ?? []) as { email_log_id: string; booking_id: string; number?: string; to_email?: string }[];
  const requests = followups.data?.requests ?? [];
  const awaiting = c.awaiting_confirmation ?? 0;

  return (
    <section aria-labelledby="dash-bookings" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dash-bookings" className="eyebrow">{t("adminBooking.dashboard.title")}</h2>
        <Link href="/admin/bookings/new"><Button size="sm" variant="secondary"><Plus className="h-4 w-4" /> {t("adminBooking.list.new")}</Button></Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={t("adminBooking.dashboard.today")} value={f.number(c.today)} hint={t("adminBooking.dashboard.next7", { count: c.next_7_days })}
          icon={<CalendarDays className="h-4 w-4" />} href="/admin/bookings?view=today" />
        <StatCard label={t("bookingRequests.dashboard.awaiting")} value={f.number(awaiting)}
          hint={(c.stale_requests ?? 0) > 0 ? t("bookingRequests.dashboard.stale", { count: c.stale_requests ?? 0 }) : undefined}
          tone={(c.stale_requests ?? 0) > 0 ? "warning" : awaiting > 0 ? "accent" : "success"}
          icon={<Hourglass className="h-4 w-4" />} href="/admin/bookings?status=requested" />
        <StatCard label={t("adminBooking.dashboard.awaitingInvoice")} value={f.number(c.awaiting_invoice)} tone={c.awaiting_invoice > 0 ? "warning" : "success"}
          icon={<FileText className="h-4 w-4" />} href="/admin/finance/to-invoice" />
        <StatCard label={t("adminBooking.dashboard.outstanding")} value={outstanding} hint={t("adminBooking.dashboard.invoices", { count: outstandingCount })}
          tone={outstandingCount > 0 ? "accent" : "success"} icon={<Wallet className="h-4 w-4" />} href="/admin/bookings?billing=outstanding" />
        <StatCard label={t("adminBooking.dashboard.followups")} value={f.number(c.failed_notifications + emails.length)} tone={c.failed_notifications + emails.length > 0 ? "danger" : "success"}
          icon={<CalendarCheck2 className="h-4 w-4" />} href={notifs[0] ? `/admin/bookings/${notifs[0].booking_id}` : emails[0] ? `/admin/bookings/${emails[0].booking_id}` : "/admin/bookings"} />
      </div>
      {(notifs.length > 0 || emails.length > 0 || requests.length > 0) && (
        <Card>
          <CardHeader><CardTitle>{t("adminBooking.dashboard.followupsTitle")}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <ul>
              {requests.map((r) => (
                <li key={`req-${r.booking_id}`} className="border-b border-border-soft last:border-0">
                  <Link href={`/admin/bookings/${r.booking_id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-elevated">
                    <span className="truncate text-text">{r.athlete_name} · {r.service_name} · {f.date(r.starts_at)} {f.time(r.starts_at)}</span>
                    <span className="shrink-0 text-xs text-warning">{t("bookingRequests.dashboard.waiting", { count: r.hours_waiting })}</span>
                  </Link>
                </li>
              ))}
              {notifs.map((n) => (
                <li key={n.id} className="border-b border-border-soft last:border-0">
                  <Link href={`/admin/bookings/${n.booking_id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-elevated">
                    <span className="truncate text-text">{n.athlete_name}{n.starts_at ? ` · ${f.date(n.starts_at)} ${f.time(n.starts_at)}` : ""}</span>
                    <span className="shrink-0 text-xs text-danger">{t.dynamic(`bookingWorkflow.notificationStatus.${n.status}`, undefined, n.status)}</span>
                  </Link>
                </li>
              ))}
              {emails.map((e) => (
                <li key={e.email_log_id} className="border-b border-border-soft last:border-0">
                  <Link href={`/admin/bookings/${e.booking_id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-elevated">
                    <span className="truncate text-text">{t("adminBooking.detail.invoiceEmail")} {e.number}</span>
                    <span className="shrink-0 text-xs text-danger">{t("bookingWorkflow.notificationStatus.failed")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </section>
  );
}

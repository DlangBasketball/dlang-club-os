"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Check, Archive } from "lucide-react";
import { Card, CardBody, Button, EmptyState, Badge } from "@/components/ui";
import { markRead, markAllRead, archiveNotification } from "@/lib/actions/notifications";
import { useFormat, useT } from "@/lib/i18n/client";
import type { ParentNotification } from "@/lib/data/parent";

/** Attendance notices (no-show alerts, corrections, correction outcomes) get a badge and link to the record. */
const ATTENDANCE_TYPES = ["attendance_no_show", "attendance_no_show_correction"];
const isAttendance = (n: ParentNotification) => ATTENDANCE_TYPES.includes(n.type) || (n.link ?? "").startsWith("/parent/attendance");
/** Booking notices (confirmed / moved / cancelled) link to the booking in the parent or player portal. */
const BOOKING_TYPES = ["booking_confirmation", "booking_rescheduled", "booking_cancellation", "booking_requested", "booking_request_declined"];
const isBooking = (n: ParentNotification) => BOOKING_TYPES.includes(n.type);

export function NotificationsClient({ initial, archived }: { initial: ParentNotification[]; archived?: boolean }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [items, setItems] = React.useState(initial);
  React.useEffect(() => setItems(initial), [initial]);
  const unread = items.filter((n) => !n.readAt).length;

  async function readOne(id: string) {
    setItems((xs) => xs.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    await markRead(id); router.refresh();
  }
  async function archive(id: string) {
    setItems((xs) => xs.filter((n) => n.id !== id));
    await archiveNotification(id); router.refresh();
  }
  async function readAll() {
    setItems((xs) => xs.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    await markAllRead(); router.refresh();
  }

  if (items.length === 0)
    return (
      <EmptyState
        icon={<Bell className="h-5 w-5" />}
        title={archived ? t("familyAttendance.notifications.emptyArchived") : t("notifications.empty")}
        description={archived ? t("familyAttendance.notifications.emptyArchivedHint") : t("notifications.emptyHint")}
      />
    );

  return (
    <div className="space-y-3">
      {!archived && unread > 0 && (
        <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={readAll}><Check className="h-4 w-4" /> {t("notifications.markAllRead")}</Button></div>
      )}
      {items.map((n) => {
        const inner = (
          <CardBody className="flex items-start justify-between gap-3 py-3">
            <div className="flex items-start gap-3">
              {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-primary" />}
              <div className={n.readAt ? "pl-[20px]" : ""}>
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                  {n.title}
                  {isAttendance(n) && <Badge tone="info">{t("nav.attendance")}</Badge>}
                  {isBooking(n) && <Badge tone="accent">{t("nav.bookings")}</Badge>}
                </div>
                {n.body && <div className="text-xs text-text-muted">{n.body}</div>}
                <div className="mt-0.5 text-[11px] text-text-subtle">{f.relative(n.createdAt)}</div>
              </div>
            </div>
            {!archived && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); archive(n.id); }}
                aria-label={t("familyAttendance.notifications.archive")} title={t("familyAttendance.notifications.archive")}
                className="shrink-0 text-text-subtle hover:text-text"
              >
                <Archive className="h-4 w-4" />
              </button>
            )}
          </CardBody>
        );
        return (
          <Card key={n.id} className={n.readAt ? "" : "border-brand-primary/30"}>
            {n.link ? <Link href={n.link as never} onClick={() => !n.readAt && readOne(n.id)}>{inner}</Link> : <div onClick={() => !n.readAt && readOne(n.id)}>{inner}</div>}
          </Card>
        );
      })}
    </div>
  );
}

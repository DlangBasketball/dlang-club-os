import { Bell } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, StatCard, Badge } from "@/components/ui";
import { listEmailLogs, emailStats, listRecentNotifications, reminderTargets } from "@/lib/data/notifications-admin";
import { ReminderPanel, BroadcastForm, EmailLogTable } from "@/components/admin/notifications-admin-client";
import { timeAgo } from "@/lib/utils";
import { CommunicationInbox } from "@/components/messaging/communication-inbox";

export default async function AdminNotificationsPage() {
  const [targets, stats, logs, recent] = await Promise.all([
    reminderTargets(),
    emailStats(),
    listEmailLogs("all", 60),
    listRecentNotifications(15),
  ]);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Notifications" description="Send reminders and broadcasts, and monitor email delivery." />

      <CommunicationInbox />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Emails sent" value={String(stats.sent)} />
        <StatCard label="Failed" value={String(stats.failed)} />
        <StatCard label="Queued" value={String(stats.queued)} />
        <StatCard label="Total logged" value={String(stats.total)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ReminderPanel overdueInvoices={targets.overdueInvoices} parents={targets.parents} />
        <BroadcastForm parents={targets.parents} />
      </div>

      <EmailLogTable logs={logs} failedCount={stats.failed} />

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4" /> Recent in-app notifications</CardTitle></CardHeader>
        <CardBody className="p-0">
          {recent.length === 0 ? (
            <div className="p-5 text-sm text-ink-3">No notifications yet.</div>
          ) : (
            <ul>
              {recent.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink">{n.title}</div>
                    <div className="truncate text-xs text-ink-3">to {n.recipientName} · {timeAgo(n.createdAt)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="neutral">{n.type}</Badge>
                    {!n.readAt && <span className="text-[11px] text-maroon">unread</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

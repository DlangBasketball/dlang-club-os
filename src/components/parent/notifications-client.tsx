"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Check, Archive } from "lucide-react";
import { Card, CardBody, Button, EmptyState } from "@/components/ui";
import { markRead, markAllRead, archiveNotification } from "@/lib/actions/notifications";
import { timeAgo } from "@/lib/utils";
import type { ParentNotification } from "@/lib/data/parent";

export function NotificationsClient({ initial, archived }: { initial: ParentNotification[]; archived?: boolean }) {
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
    return <EmptyState icon={<Bell className="h-5 w-5" />} title={archived ? "No archived notifications" : "No notifications"} description={archived ? "Archived items will appear here." : "You're all caught up."} />;

  return (
    <div className="space-y-3">
      {!archived && unread > 0 && (
        <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={readAll}><Check className="h-4 w-4" /> Mark all read</Button></div>
      )}
      {items.map((n) => {
        const inner = (
          <CardBody className="flex items-start justify-between gap-3 py-3">
            <div className="flex items-start gap-3">
              {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-maroon" />}
              <div className={n.readAt ? "pl-[20px]" : ""}>
                <div className="text-sm font-medium text-ink">{n.title}</div>
                {n.body && <div className="text-xs text-ink-3">{n.body}</div>}
                <div className="mt-0.5 text-[11px] text-ink-4">{timeAgo(n.createdAt)}</div>
              </div>
            </div>
            {!archived && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); archive(n.id); }} aria-label="Archive" className="shrink-0 text-ink-4 hover:text-ink" title="Archive"><Archive className="h-4 w-4" /></button>
            )}
          </CardBody>
        );
        return (
          <Card key={n.id} className={n.readAt ? "" : "border-maroon/30"}>
            {n.link ? <Link href={n.link as never} onClick={() => !n.readAt && readOne(n.id)}>{inner}</Link> : <div onClick={() => !n.readAt && readOne(n.id)}>{inner}</div>}
          </Card>
        );
      })}
    </div>
  );
}

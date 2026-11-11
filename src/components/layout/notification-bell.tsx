"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, X } from "lucide-react";
import { markRead, markAllRead, archiveNotification } from "@/lib/actions/notifications";
import { timeAgo, cn } from "@/lib/utils";
import type { NavNotification } from "@/lib/data/notifications";

export function NotificationBell({ initial, viewAllHref }: { initial: { items: NavNotification[]; unread: number }; viewAllHref?: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState(initial.items);
  const ref = React.useRef<HTMLDivElement>(null);
  const unread = items.filter((i) => !i.readAt).length;

  React.useEffect(() => setItems(initial.items), [initial.items]);
  React.useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function onRead(id: string) {
    setItems((xs) => xs.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    await markRead(id); router.refresh();
  }
  async function onArchive(id: string) {
    setItems((xs) => xs.filter((n) => n.id !== id));
    await archiveNotification(id); router.refresh();
  }
  async function onReadAll() {
    setItems((xs) => xs.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    await markAllRead(); router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label="Notifications" className="relative flex items-center justify-center rounded p-2 text-ink-2 hover:text-ink">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-maroon px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && <button onClick={onReadAll} className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><Check className="h-3.5 w-3.5" /> Mark all read</button>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-ink-3">You&rsquo;re all caught up.</div>
            ) : (
              items.map((n) => {
                const Inner = (
                  <div className={cn("flex items-start gap-2.5 px-4 py-3", !n.readAt && "bg-maroon-soft/30")}>
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-maroon" />}
                    <div className={cn("min-w-0 flex-1", n.readAt && "pl-[18px]")}>
                      <div className="truncate text-sm font-medium text-ink">{n.title}</div>
                      {n.body && <div className="line-clamp-2 text-xs text-ink-3">{n.body}</div>}
                      <div className="mt-0.5 text-[11px] text-ink-4">{timeAgo(n.createdAt)}</div>
                    </div>
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onArchive(n.id); }} aria-label="Archive" className="shrink-0 text-ink-4 hover:text-ink"><X className="h-3.5 w-3.5" /></button>
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link as never} onClick={() => { if (!n.readAt) onRead(n.id); setOpen(false); }} className="block border-b border-line-soft last:border-0 hover:bg-surface-elevated/50">{Inner}</Link>
                ) : (
                  <div key={n.id} onClick={() => !n.readAt && onRead(n.id)} className="cursor-default border-b border-line-soft last:border-0">{Inner}</div>
                );
              })
            )}
          </div>
          {viewAllHref && (
            <Link href={viewAllHref as never} onClick={() => setOpen(false)} className="block border-t border-line-soft px-4 py-2.5 text-center text-xs font-medium text-maroon hover:bg-surface-elevated/50">View all</Link>
          )}
        </div>
      )}
    </div>
  );
}

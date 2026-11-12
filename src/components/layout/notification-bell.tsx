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
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
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
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "touch-target relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-[color,border-color,box-shadow] duration-150",
          "hover:border-brand-primary hover:text-brand-primary hover:shadow-glow focus-visible:outline-none focus-visible:shadow-focus",
          open && "border-brand-primary text-brand-primary",
        )}
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-bg-secondary bg-brand-primary px-1 text-[10px] font-semibold text-on-brand shadow-glow">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-2rem)] animate-fade-up overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-3">
            <span className="font-display text-base font-medium text-text">Notifications</span>
            {unread > 0 && <button onClick={onReadAll} className="touch-target -mr-2 flex items-center gap-1 rounded px-2 text-xs text-text-muted hover:text-text focus-visible:outline-none focus-visible:shadow-focus"><Check className="h-3.5 w-3.5" aria-hidden /> Mark all read</button>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-text-muted">You&rsquo;re all caught up.</div>
            ) : (
              items.map((n) => {
                const Inner = (
                  <div className={cn("flex items-start gap-2.5 px-4 py-3", !n.readAt && "bg-brand-primary-soft")}>
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-primary shadow-glow" aria-label="Unread" />}
                    <div className={cn("min-w-0 flex-1", n.readAt && "pl-[18px]")}>
                      <div className="truncate text-sm font-medium text-text">{n.title}</div>
                      {n.body && <div className="line-clamp-2 text-xs text-text-muted">{n.body}</div>}
                      <div className="mt-0.5 text-[11px] text-text-subtle">{timeAgo(n.createdAt)}</div>
                    </div>
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onArchive(n.id); }} aria-label="Archive" className="touch-target -m-1.5 shrink-0 rounded p-1.5 text-text-subtle hover:bg-surface-elevated hover:text-text focus-visible:outline-none focus-visible:shadow-focus"><X className="h-3.5 w-3.5" aria-hidden /></button>
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link as never} onClick={() => { if (!n.readAt) onRead(n.id); setOpen(false); }} className="block border-b border-border-soft last:border-0 hover:bg-surface-elevated focus-visible:outline-none focus-visible:bg-surface-elevated">{Inner}</Link>
                ) : (
                  <div key={n.id} onClick={() => !n.readAt && onRead(n.id)} className="cursor-default border-b border-border-soft last:border-0">{Inner}</div>
                );
              })
            )}
          </div>
          {viewAllHref && (
            <Link href={viewAllHref as never} onClick={() => setOpen(false)} className="block border-t border-border bg-bg-secondary px-4 py-3 text-center text-xs font-medium text-brand-primary hover:bg-surface-elevated focus-visible:outline-none focus-visible:shadow-focus">View all</Link>
          )}
        </div>
      )}
    </div>
  );
}

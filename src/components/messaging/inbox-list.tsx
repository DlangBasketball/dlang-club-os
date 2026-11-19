"use client";

import Link from "next/link";
import { Building2, Hash, Lock, MessagesSquare, Users } from "lucide-react";
import { Badge } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { InboxRow } from "@/lib/messaging/db";
import { threadTitle } from "@/lib/messaging/format";

export function InboxList({ items, base, showFamily = true, empty }: { items: InboxRow[]; base: string; showFamily?: boolean; empty?: string }) {
  const t = useT();
  const f = useFormat();
  if (!items.length) return <div className="px-5 py-10 text-center text-sm text-text-muted">{empty ?? t("messaging.inbox.empty")}</div>;
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => {
        const Icon = i.kind === "channel" ? Hash : i.office ? Building2 : i.has_family_side ? Users : MessagesSquare;
        return (
          <li key={i.conversation_id}>
            <Link
              href={`${base}/${i.conversation_id}` as never}
              className={cn(
                "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:shadow-focus",
                i.unread > 0 && "bg-brand-primary-soft",
              )}
            >
              <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text-muted">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn("truncate text-sm", i.unread > 0 ? "font-semibold text-text" : "text-text")}>{threadTitle(t, i)}</span>
                  {i.status === "closed" && <Badge tone="neutral"><Lock className="h-3 w-3" aria-hidden /> {t("messaging.thread.closed")}</Badge>}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {[
                    i.kind === "channel" ? t("messaging.inbox.channel") : i.office ? t("messaging.inbox.office") : null,
                    showFamily && i.family_name ? i.family_name : null,
                    i.subject && i.people ? i.people : null,
                  ].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <time className="text-[11px] text-text-subtle" dateTime={i.last_message_at}>{f.relative(i.last_message_at)}</time>
                {i.unread > 0 && (
                  <span className="rounded-full bg-brand-primary px-1.5 text-[11px] font-semibold text-on-brand" aria-label={t("messaging.inbox.unreadCount", { count: i.unread })}>
                    {i.unread}
                  </span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

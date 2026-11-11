import Link from "next/link";
import { PageHeader, ErrorState } from "@/components/ui";
import { listNotifications } from "@/lib/data/parent";
import { NotificationsClient } from "@/components/parent/notifications-client";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "active", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "archived", label: "Archived" },
] as const;

export default async function ParentNotificationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = (["active", "unread", "archived"].includes(sp.status ?? "") ? sp.status : "active") as "active" | "unread" | "archived";
  const { data, error } = await listNotifications(status);
  if (error) return (<div className="animate-fade-up"><PageHeader title="Notifications" /><ErrorState title="Couldn't load" message={error} /></div>);

  return (
    <div className="animate-fade-up">
      <PageHeader title="Notifications" description="Club updates, payment reminders and practice notices." />
      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-surface-card p-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/parent/notifications?status=${t.key}`}
            className={cn("flex-1 rounded-md px-3 py-1.5 text-center text-sm transition-colors", status === t.key ? "bg-maroon-soft text-inverse" : "text-ink-3 hover:text-ink")}>
            {t.label}
          </Link>
        ))}
      </div>
      <NotificationsClient initial={data!} archived={status === "archived"} />
    </div>
  );
}

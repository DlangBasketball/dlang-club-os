import Link from "next/link";
import { PageHeader, ErrorState } from "@/components/ui";
import { listNotifications } from "@/lib/data/parent";
import { NotificationsClient } from "@/components/parent/notifications-client";
import { getTranslations } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const TABS = ["active", "unread", "archived"] as const;

/** Parent notifications: club notices, payment reminders, attendance alerts and correction outcomes (linked to the record). */
export default async function ParentNotificationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations();
  const status = (TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof TABS)[number]) : "active";
  const { data, error } = await listNotifications(status);
  if (error) {
    return (
      <div className="animate-fade-up">
        <PageHeader title={t("notifications.title")} />
        <ErrorState title={t("notifications.title")} message={error} />
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title={t("notifications.title")} description={t("familyAttendance.notifications.description")} />
      <nav className="mb-4 flex gap-1 rounded-lg border border-border bg-surface p-1">
        {TABS.map((key) => (
          <Link key={key} href={`/parent/notifications?status=${key}`} aria-current={status === key ? "page" : undefined}
            className={cn("flex-1 rounded-md px-3 py-1.5 text-center text-sm transition-colors", status === key ? "bg-brand-primary-soft text-text" : "text-text-muted hover:text-text")}>
            {t(`familyAttendance.notifications.tabs.${key}`)}
          </Link>
        ))}
      </nav>
      <NotificationsClient initial={data!} archived={status === "archived"} />
    </div>
  );
}

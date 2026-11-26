import Link from "next/link";
import { Flag } from "lucide-react";
import { Badge } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getCommunicationOverview } from "@/lib/messaging/data";
import { CommunicationCard } from "./pages";
import { InboxList } from "./inbox-list";

/**
 * Notifications page, admin: parent messages, employee messages and new
 * contacts side by side (the "communication management" overview).
 */
export async function CommunicationInbox() {
  const { t, f } = await getI18n();
  const { parent, staff, leads, reports } = await getCommunicationOverview();
  return (
    <section aria-labelledby="comm-inbox" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="comm-inbox" className="font-display text-xl font-medium text-text">{t("messaging.overview.title")}</h2>
        {reports > 0 && (
          <Link href="/admin/messages/settings"><Badge tone="danger"><Flag className="h-3 w-3" aria-hidden /> {t("messaging.overview.reports", { count: reports })}</Badge></Link>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CommunicationCard title={t("messaging.overview.parents")} href="/admin/messages?view=all" linkLabel={t("messaging.overview.viewAll")}>
          <InboxList items={parent} base="/admin/messages" empty={t("messaging.overview.noParents")} />
        </CommunicationCard>
        <CommunicationCard title={t("messaging.overview.staff")} href="/admin/messages" linkLabel={t("messaging.overview.viewAll")}>
          <InboxList items={staff} base="/admin/messages" showFamily={false} empty={t("messaging.overview.noStaff")} />
        </CommunicationCard>
        <CommunicationCard title={t("messaging.overview.leads")} href="/admin/leads" linkLabel={t("messaging.overview.viewAll")}>
          {leads.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-text-muted">{t("messaging.overview.noLeads")}</div>
          ) : (
            <ul className="divide-y divide-border">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link href={`/admin/leads/${l.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-elevated">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text">{l.name}</div>
                      <div className="truncate text-xs text-text-muted">{t(`messaging.leads.interest.${l.interest}`)}</div>
                    </div>
                    <time className="shrink-0 text-[11px] text-text-subtle" dateTime={l.created_at}>{f.relative(l.created_at)}</time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CommunicationCard>
      </div>
    </section>
  );
}

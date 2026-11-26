import Link from "next/link";
import { Inbox } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { AutoRefresh } from "@/components/messaging/auto-refresh";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listLeads } from "@/lib/messaging/data";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/messaging/validation";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("messaging.leads.title") };
}

const TONE: Record<LeadStatus, "info" | "warning" | "success" | "neutral"> = { new: "info", replied: "warning", converted: "success", closed: "neutral" };

/** New contacts from the public "Contact us" forms (admins). */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireRole(["admin"]);
  const [{ t, f }, sp] = await Promise.all([getI18n(), searchParams]);
  const status = (LEAD_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as LeadStatus) : "open";
  const leads = await listLeads(status);
  const filters: { key: string; label: string }[] = [
    { key: "open", label: t("messaging.leads.filterOpen") },
    ...LEAD_STATUSES.map((s) => ({ key: s, label: t(`messaging.leads.statuses.${s}`) })),
  ];
  return (
    <div className="animate-fade-up space-y-5">
      <AutoRefresh />
      <PageHeader title={t("messaging.leads.title")} description={t("messaging.leads.description")} />
      <nav className="flex flex-wrap gap-2" aria-label={t("messaging.leads.status")}>
        {filters.map((x) => (
          <Link key={x.key} href={x.key === "open" ? "/admin/leads" : `/admin/leads?status=${x.key}`} aria-current={status === x.key ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-xs", status === x.key ? "border-brand-primary bg-brand-primary-soft text-brand-primary" : "border-border text-text-muted hover:text-text")}>
            {x.label}
          </Link>
        ))}
      </nav>
      {leads.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t("messaging.leads.empty")} />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {leads.map((l) => (
              <li key={l.id}>
                <Link href={`/admin/leads/${l.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-elevated focus-visible:outline-none focus-visible:shadow-focus">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("text-sm text-text", l.status === "new" && "font-semibold")}>{l.name}</span>
                      <Badge tone="neutral">{t(`messaging.leads.interest.${l.interest}`)}</Badge>
                    </div>
                    <p className="line-clamp-1 text-xs text-text-muted">{l.message}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={TONE[l.status]}>{t(`messaging.leads.statuses.${l.status}`)}</Badge>
                    <time className="text-[11px] text-text-subtle" dateTime={l.created_at}>{f.relative(l.created_at)}</time>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

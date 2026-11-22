import { UserCircle, Users, FileText, AlertCircle, CalendarClock, CheckSquare } from "lucide-react";
import { StatCard, ErrorState } from "@/components/ui";
import { Skeleton } from "@/components/ui";
import { getKpis } from "@/lib/data/dashboard";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { labelsFor } from "@/lib/sportsops/labels";

export async function KpiCards() {
  const [{ t, f }, tenant] = await Promise.all([getI18n(), getTenant()]);
  const { data, error } = await getKpis(f.timeZone);
  if (error) return <ErrorState title={t("dashboard.widgets.kpi.loadError")} message={error} />;
  const k = data!;
  const labels = labelsFor(tenant.terminology);
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard label={t("dashboard.widgets.kpi.activeAthletes", { label: labels.athletes })} value={f.number(k.activeAthletes)} icon={<UserCircle className="h-5 w-5" />} href="/admin/athletes" />
      <StatCard label={t("dashboard.widgets.kpi.activeFamilies")} value={f.number(k.activeFamilies)} icon={<Users className="h-5 w-5" />} href="/admin/families" />
      <StatCard label={t("dashboard.widgets.kpi.openInvoices")} value={f.number(k.openInvoices)} icon={<FileText className="h-5 w-5" />} href="/admin/invoices?status=open" />
      <StatCard label={t("dashboard.widgets.kpi.overdue")} value={f.number(k.overdueInvoices)} icon={<AlertCircle className="h-5 w-5" />} href="/admin/invoices?status=overdue" accent={k.overdueInvoices > 0} />
      <StatCard label={t("dashboard.widgets.kpi.upcomingSessions")} value={f.number(k.upcomingSessions)} icon={<CalendarClock className="h-5 w-5" />} href="/admin/calendar?view=list" />
      <StatCard label={t("dashboard.widgets.kpi.sessionsToday")} value={f.number(k.sessionsToday)} icon={<CheckSquare className="h-5 w-5" />} href="/admin/calendar?view=day" />
    </div>
  );
}

export function KpiCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-4 h-8 w-12" />
        </div>
      ))}
    </div>
  );
}

import { UserCircle, Users, FileText, AlertCircle, CalendarClock, CheckSquare } from "lucide-react";
import { StatCard, ErrorState } from "@/components/ui";
import { Skeleton } from "@/components/ui";
import { getKpis } from "@/lib/data/dashboard";

export async function KpiCards() {
  const { data, error } = await getKpis();
  if (error) return <ErrorState title="Couldn't load KPIs" message={error} />;
  const k = data!;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Active athletes" value={String(k.activeAthletes)} icon={<UserCircle className="h-5 w-5" />} href="/admin/athletes" />
      <StatCard label="Active families" value={String(k.activeFamilies)} icon={<Users className="h-5 w-5" />} href="/admin/families" />
      <StatCard label="Open invoices" value={String(k.openInvoices)} icon={<FileText className="h-5 w-5" />} href="/admin/invoices" />
      <StatCard label="Overdue" value={String(k.overdueInvoices)} icon={<AlertCircle className="h-5 w-5" />} href="/admin/invoices" accent={k.overdueInvoices > 0} />
      <StatCard label="Upcoming sessions" value={String(k.upcomingSessions)} icon={<CalendarClock className="h-5 w-5" />} href="/admin/attendance" />
      <StatCard label="Sessions today" value={String(k.sessionsToday)} icon={<CheckSquare className="h-5 w-5" />} href="/admin/attendance" />
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

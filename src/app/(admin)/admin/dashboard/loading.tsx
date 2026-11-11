import { KpiCardsSkeleton } from "@/components/dashboard/kpi-cards";
import { SkeletonCard, Skeleton } from "@/components/ui";

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-8 w-64" />
      </div>
      <KpiCardsSkeleton />
      <SkeletonCard rows={2} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2"><SkeletonCard rows={6} /></div>
        <div className="space-y-6"><SkeletonCard rows={2} /><SkeletonCard rows={1} /></div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SkeletonCard rows={4} /><SkeletonCard rows={4} /><SkeletonCard rows={4} />
      </div>
    </div>
  );
}

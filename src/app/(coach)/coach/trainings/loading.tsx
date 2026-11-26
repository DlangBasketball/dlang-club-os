import { Skeleton, SkeletonCard } from "@/components/ui";

export default function CoachTrainingsLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
      <div className="space-y-2"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-72" /></div>
      {[0, 1, 2].map((i) => <SkeletonCard key={i} rows={3} />)}
    </div>
  );
}

import { Skeleton, SkeletonCard } from "@/components/ui";

export default function TrainingDetailsLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-56" />
      {[0, 1, 2].map((i) => <SkeletonCard key={i} rows={4} />)}
    </div>
  );
}

import { Skeleton } from "@/components/ui";

export default function ParentLoading() {
  return (
    <div className="animate-fade-up space-y-6">
      <div className="space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-40" /></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
      </div>
      <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
    </div>
  );
}

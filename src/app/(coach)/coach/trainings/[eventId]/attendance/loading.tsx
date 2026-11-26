import { Skeleton } from "@/components/ui";

export default function TakeAttendanceLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-3" aria-busy="true">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
    </div>
  );
}

import { cn } from "@/lib/utils";

/**
 * Skeleton — shimmer placeholder. Hidden from assistive tech; the shimmer is
 * disabled automatically under prefers-reduced-motion (globals.css).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded bg-surface-elevated bg-[length:200%_100%]",
        "bg-[linear-gradient(90deg,var(--surface-elevated)_0%,var(--border)_50%,var(--surface-elevated)_100%)]",
        className,
      )}
    />
  );
}

/** A card-shaped skeleton with N shimmer rows. */
export function SkeletonCard({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("rounded-md border border-border bg-surface p-[18px]", className)}
    >
      <Skeleton className="mb-4 h-4 w-32" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className={cn("h-4", i === rows - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

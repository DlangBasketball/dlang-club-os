import { cn } from "@/lib/utils";

export function BrandMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-maroon shadow-glow-red">
        <span className="font-display text-lg font-bold text-inverse">D</span>
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="font-display text-sm font-semibold text-ink">
            DLang Basketball
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
            Club OS
          </div>
        </div>
      )}
    </div>
  );
}

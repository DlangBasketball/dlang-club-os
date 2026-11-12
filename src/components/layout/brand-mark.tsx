import { cn } from "@/lib/utils";

/**
 * Wordmark — prototype `.dl-wordmark`: gradient brand tile + display-serif
 * name + uppercase tag. Name/tag/initial are props so a tenant's identity
 * can be passed in; defaults are the founding club.
 */
export function BrandMark({
  compact = false,
  className,
  name = "DLang Basketball",
  tagline = "Club OS",
  initial,
}: {
  compact?: boolean;
  className?: string;
  name?: string;
  tagline?: string;
  initial?: string;
}) {
  const letter = (initial ?? name.trim().charAt(0) ?? "C").toUpperCase();
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-primary to-brand-primary-dark shadow-glow"
      >
        <span className="font-display text-lg font-semibold text-on-brand">{letter}</span>
      </div>
      {compact ? (
        <span className="sr-only">{name}</span>
      ) : (
        <div className="min-w-0 leading-tight">
          <div className="truncate font-display text-[15px] font-medium tracking-[-0.02em] text-text">
            {name}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
            {tagline}
          </div>
        </div>
      )}
    </div>
  );
}

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "brand" | "success" | "warning" | "danger" | "accent";

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  href?: string;
  /** Highlight treatment (gold accent bar + warm gradient, prototype `.kpi.gold`). */
  accent?: boolean;
  /** Colour of the left accent bar (prototype `.kpi.green/.amber/.danger`). */
  tone?: StatTone;
}

const BAR: Record<StatTone, string> = {
  brand: "before:bg-brand-primary",
  success: "before:bg-success",
  warning: "before:bg-warning",
  danger: "before:bg-danger",
  accent: "before:bg-brand-accent",
};

/** KPI tile — prototype `.kpi`: eyebrow label, display-serif figure, 3px bar. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  accent,
  tone,
}: StatCardProps) {
  const t: StatTone = tone ?? (accent ? "accent" : "brand");
  const inner = (
    <div
      className={cn(
        "group relative h-full overflow-hidden rounded-md border border-border bg-surface px-[18px] pb-3.5 pt-4 shadow-sm transition-[border-color,box-shadow] duration-150",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        BAR[t],
        accent && "bg-gradient-to-br from-surface to-brand-accent-soft",
        href && "group-hover:border-brand-primary/50 group-hover:shadow-glow",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="eyebrow">{label}</span>
        {icon && (
          <span className="text-brand-primary [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <div className="mb-1 mt-1.5 font-display text-[30px] font-medium leading-tight tracking-[-0.02em] text-text [font-feature-settings:'tnum']">
        {value}
      </div>
      {hint && <div className="text-xs text-text-muted">{hint}</div>}
      {href && (
        <ArrowUpRight
          aria-hidden
          className={cn(
            "absolute right-4 h-4 w-4 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
            icon ? "bottom-4" : "top-4",
          )}
        />
      )}
    </div>
  );
  return href ? (
    <Link
      href={href as never}
      className="group block rounded-md focus-visible:outline-none focus-visible:shadow-focus"
    >
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Responsive KPI strip — prototype `.kpi-grid`. */
export function StatGrid({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-3.5 lg:grid-cols-4", className)}
      {...props}
    />
  );
}

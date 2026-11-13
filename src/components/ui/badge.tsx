import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Badge — prototype `.pill`: tinted fill, matching hairline border. */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-[1.35] tracking-[0.01em]",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-elevated text-text-secondary",
        success: "border-success/30 bg-success-soft text-success",
        warning: "border-warning/30 bg-warning-soft text-warning",
        danger: "border-danger/30 bg-danger-soft text-danger",
        maroon: "border-brand-primary/30 bg-brand-primary-soft text-brand-primary",
        brand: "border-brand-primary/30 bg-brand-primary-soft text-brand-primary",
        accent: "border-brand-accent/30 bg-brand-accent-soft text-brand-accent",
        info: "border-info/30 bg-info-soft text-info",
        premium:
          "border-transparent bg-gradient-to-br from-brand-accent to-brand-accent-dark font-semibold text-on-accent",
      },
      dot: {
        true: "before:h-1.5 before:w-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']",
        false: "",
      },
    },
    defaultVariants: { tone: "neutral", dot: false },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, dot, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, dot }), className)} {...props} />;
}

/** Map a domain status string to a badge tone. */
export function statusTone(status: string): BadgeProps["tone"] {
  const s = status.toLowerCase();
  if (["paid", "confirmed", "succeeded", "present", "active"].includes(s))
    return "success";
  if (["pending", "waitlist", "draft", "late", "open", "sent", "partially_paid"].includes(s))
    return "warning";
  if (["overdue", "failed", "absent", "void", "cancelled"].includes(s))
    return "danger";
  return "neutral";
}

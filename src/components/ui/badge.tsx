import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-surface-elevated text-ink-2 border border-line",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        maroon: "bg-maroon-soft text-maroon",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
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

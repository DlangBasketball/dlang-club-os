import * as React from "react";
import { cn, initials } from "@/lib/utils";

const SIZES = {
  sm: "h-7 w-7 text-[10.5px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-[13px]",
  xl: "h-16 w-16 text-xl",
} as const;

/** Initials avatar — prototype `.avatar` (brand tint) / `.avatar.gold`. */
export function Avatar({
  name,
  size = "md",
  tone = "brand",
  className,
}: {
  name: string | null | undefined;
  size?: keyof typeof SIZES;
  tone?: "brand" | "accent" | "neutral";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        SIZES[size],
        tone === "brand" && "bg-gradient-to-br from-brand-primary to-brand-primary-dark text-on-brand",
        tone === "accent" && "bg-brand-accent text-on-accent",
        tone === "neutral" && "border border-border bg-bg-secondary text-text-secondary",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

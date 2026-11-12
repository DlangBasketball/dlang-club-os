import * as React from "react";
import { cn } from "@/lib/utils";

/** Card — prototype `.card`: surface, 1px border, md radius, lift on hover. */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface text-text shadow-sm transition-shadow duration-150",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2.5 border-b border-border-soft px-[18px] py-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-display text-lg font-medium leading-tight tracking-[-0.01em] text-text",
        className,
      )}
      {...props}
    />
  );
}

/** Small muted text placed at the right of a CardHeader. */
export function CardMeta({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-xs text-text-muted", className)} {...props} />;
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-[18px]", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-b-md border-t border-border bg-bg-secondary px-[18px] py-3 text-[12.5px] text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

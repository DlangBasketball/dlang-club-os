import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card } from "./card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  href?: string;
  accent?: boolean;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  accent,
}: StatCardProps) {
  const inner = (
    <Card
      className={cn(
        "group relative overflow-hidden p-5 transition-all",
        href && "hover:border-maroon/50 hover:shadow-glow-red",
        accent && "bg-radial-maroon",
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </span>
        {icon && <span className="text-maroon">{icon}</span>}
      </div>
      <div className="mt-3 tnum text-3xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
      {href && (
        <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </Card>
  );
  return href ? <Link href={href as never}>{inner}</Link> : inner;
}

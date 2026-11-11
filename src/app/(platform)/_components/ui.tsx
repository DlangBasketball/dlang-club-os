import * as React from "react";
import { Badge } from "@/components/ui";
import type { SubscriptionStatus } from "@/lib/platform/types";

export function SubscriptionBadge({
  status,
  suspended,
}: {
  status: SubscriptionStatus | null;
  suspended?: boolean;
}) {
  if (suspended) return <Badge tone="danger">suspended</Badge>;
  if (!status) return <Badge tone="neutral">no plan</Badge>;
  const tone =
    status === "active"
      ? "success"
      : status === "trialing"
        ? "maroon"
        : status === "past_due" || status === "incomplete" || status === "paused"
          ? "warning"
          : "danger";
  return <Badge tone={tone}>{status.replace("_", " ")}</Badge>;
}

export function UsageMeter({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / Math.max(limit, 1)) * 100)) : 0;
  const over = limit !== null && used > limit;
  return (
    <div className="min-w-[96px]">
      <div className="tnum text-xs text-ink-2">
        {used}
        <span className="text-ink-3"> / {limit === null ? "∞" : limit}</span>
      </div>
      {limit !== null && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-elevated">
          <div
            className={over ? "h-full bg-danger" : pct > 85 ? "h-full bg-warning" : "h-full bg-[#C19A45]"}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft py-2 last:border-b-0">
      <dt className="text-xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm text-ink">{children ?? "—"}</dd>
    </div>
  );
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(d));
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
}

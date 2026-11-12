import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Error state — warning-tinted inline alert (announced to screen readers). */
export function ErrorState({
  title = "Couldn't load this",
  message,
  action,
  compact,
}: {
  title?: string;
  message?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-warning/30 bg-warning-soft text-text",
        compact ? "p-3.5" : "p-5",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-warning" aria-hidden>
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{title}</p>
          {message && <p className="mt-1 text-xs text-text-secondary">{message}</p>}
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}

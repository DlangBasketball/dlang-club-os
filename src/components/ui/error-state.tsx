import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "./card";

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
    <Card className={compact ? "p-4" : "p-6"}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-warning">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title}</p>
          {message && <p className="mt-1 text-xs text-ink-3">{message}</p>}
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </Card>
  );
}

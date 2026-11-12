import * as React from "react";
import { Card } from "./card";

/** Empty state — centred, calm; brand-tinted icon well. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center border-dashed px-6 py-14 text-center shadow-none">
      {icon && (
        <div
          aria-hidden
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-brand-primary/25 bg-brand-primary-soft text-brand-primary [&>svg]:h-5 [&>svg]:w-5"
        >
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-medium text-text">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

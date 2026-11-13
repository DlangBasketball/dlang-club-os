import * as React from "react";

/** Page header — prototype `.page-head`: crumbs, display title, lede, actions. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  /** Small line above the title (breadcrumbs / section name). */
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-border pb-[18px] sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 text-xs tracking-[0.04em] text-text-muted">{eyebrow}</div>
        )}
        <h1 className="text-balance font-display text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-text sm:text-[32px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-[560px] text-sm text-text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

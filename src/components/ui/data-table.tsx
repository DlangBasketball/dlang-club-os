import * as React from "react";
import { Card } from "./card";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  align?: "left" | "right";
};

/**
 * DataTable — prototype `.table`: eyebrow headers on a secondary band,
 * hairline row dividers, row hover tint. Scrolls horizontally on small
 * screens (the scroll region is keyboard-focusable and labelled).
 */
export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  empty,
  getRowKey,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: React.ReactNode;
  getRowKey?: (row: T, i: number) => string;
  /** Visually hidden table caption for screen readers. */
  caption?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <Card className="overflow-hidden">
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={caption ?? "Table"}
      >
        <table className="w-full border-collapse text-[13.5px]">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-border bg-bg-secondary text-left">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-[18px] py-2.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-text-muted",
                    c.align === "right" && "text-right",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={getRowKey ? getRowKey(row, i) : i}
                className="border-b border-border-soft transition-colors duration-150 last:border-0 hover:bg-surface-elevated"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-[18px] py-[13px] align-middle text-text-secondary",
                      c.align === "right" && "text-right tnum",
                    )}
                  >
                    {c.render ? c.render(row) : String(row[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

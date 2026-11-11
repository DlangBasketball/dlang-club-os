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

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  empty,
  getRowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: React.ReactNode;
  getRowKey?: (row: T, i: number) => string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-5 py-3 text-xs font-medium uppercase tracking-wide text-ink-3",
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
                className="border-b border-line-soft last:border-0 transition-colors hover:bg-surface-elevated/50"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-5 py-3.5 text-ink-2",
                      c.align === "right" && "text-right",
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

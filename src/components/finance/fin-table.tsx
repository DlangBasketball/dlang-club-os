import * as React from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

export type FinCol<T> = { key: string; header: string; cell: (r: T) => React.ReactNode; align?: "right"; className?: string };

/** A titled, horizontally scrollable table for finance views. */
export function FinTable<T>({ title, subtitle, actions, cols, rows, rowKey, empty, footer, caption }: {
  title?: string; subtitle?: string; actions?: React.ReactNode; cols: FinCol<T>[]; rows: T[];
  rowKey: (r: T, i: number) => string; empty: string; footer?: React.ReactNode; caption: string;
}) {
  return (
    <Card className="overflow-hidden">
      {(title || actions) && (
        <CardHeader>
          <div>{title && <CardTitle>{title}</CardTitle>}{subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}</div>
          {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
        </CardHeader>
      )}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line-soft text-left">
              {cols.map((c) => (
                <th key={c.key} scope="col" className={cn("whitespace-nowrap px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-3", c.align === "right" && "text-right")}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={cols.length} className="px-5 py-8 text-center text-ink-3">{empty}</td></tr>}
            {rows.map((r, i) => (
              <tr key={rowKey(r, i)} className="border-b border-line-soft last:border-0">
                {cols.map((c) => <td key={c.key} className={cn("px-5 py-2.5 text-ink-2", c.align === "right" && "whitespace-nowrap text-right tnum", c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="border-t border-line">{footer}</tfoot>}
        </table>
      </div>
    </Card>
  );
}

/** Signed amount with a tone: positive success, negative danger. */
export function Signed({ value, text }: { value: number; text: string }) {
  return <span className={cn("tnum", value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-ink-3")}>{text}</span>;
}

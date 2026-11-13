import Link from "next/link";
import { Download } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

export type ReportCol<T> = { header: string; cell: (r: T) => React.ReactNode; align?: "right"; className?: string };

/** A titled table with a CSV export link. */
export function ReportCard<T>({ title, subtitle, exportHref, cols, rows, rowKey, footer, empty = "No data for this period." }: {
  title: string; subtitle?: string; exportHref?: string; cols: ReportCol<T>[]; rows: T[]; rowKey: (r: T, i: number) => string;
  footer?: React.ReactNode; empty?: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div><CardTitle>{title}</CardTitle>{subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}</div>
        {exportHref && <Link href={exportHref} prefetch={false} className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink"><Download className="h-3.5 w-3.5" /> CSV</Link>}
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line-soft text-left">
            {cols.map((c) => <th key={c.header} className={cn("px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-3", c.align === "right" && "text-right")}>{c.header}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={cols.length} className="px-5 py-8 text-center text-ink-3">{empty}</td></tr>}
            {rows.map((r, i) => (
              <tr key={rowKey(r, i)} className="border-b border-line-soft last:border-0">
                {cols.map((c) => <td key={c.header} className={cn("px-5 py-2.5 text-ink-2", c.align === "right" && "text-right tnum", c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="border-t border-line">{footer}</tfoot>}
        </table>
      </div>
    </Card>
  );
}

export function RateBar({ rate }: { rate: number | null }) {
  if (rate == null) return <span className="text-ink-4">—</span>;
  const tone = rate >= 85 ? "bg-success" : rate >= 70 ? "bg-warning" : "bg-danger";
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-elevated sm:inline-block"><span className={cn("block h-full", tone)} style={{ width: `${Math.min(rate, 100)}%` }} /></span>
      <span className="tnum text-ink">{rate.toFixed(1)}%</span>
    </span>
  );
}

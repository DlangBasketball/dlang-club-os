import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";
import type { PeriodKind } from "@/lib/staff/hours";
import { cn } from "@/lib/utils";

/** Week / month switcher with previous / next links (plain GET links). */
export function PeriodToolbar({
  basePath, period, f, t,
}: { basePath: string; period: { kind: PeriodKind; from: string; to: string; prev: string; next: string }; f: Formatter; t: Translator }) {
  const href = (kind: PeriodKind, from: string) => `${basePath}?period=${kind}&from=${from}`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <Link href={href(period.kind, period.prev)} aria-label={t("staff.calendar.previous")}>
          <Button size="icon" variant="secondary" className="h-9 w-9"><ChevronLeft className="h-4 w-4" /></Button>
        </Link>
        <Link href={href(period.kind, period.next)} aria-label={t("staff.calendar.next")}>
          <Button size="icon" variant="secondary" className="h-9 w-9"><ChevronRight className="h-4 w-4" /></Button>
        </Link>
      </div>
      <span className="text-sm font-medium text-text">{f.date(period.from)} – {f.date(period.to)}</span>
      <div className="ml-auto flex rounded border border-border p-0.5 text-xs">
        {(["week", "month"] as const).map((k) => (
          <Link key={k} href={href(k, period.from)}
            className={cn("rounded px-3 py-1.5", period.kind === k ? "bg-brand-primary text-on-brand" : "text-text-muted hover:text-text")}>
            {t(k === "week" ? "staff.timesheets.week" : "staff.timesheets.month")}
          </Link>
        ))}
      </div>
    </div>
  );
}

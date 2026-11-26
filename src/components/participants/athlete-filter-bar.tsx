import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Translator } from "@/lib/i18n/translator";
import type { AthleteFilter } from "@/lib/participants/active-athlete";
import { ALL_ATHLETES } from "@/lib/participants/active-athlete";

/**
 * Per-page athlete filter (server component): "All" + one link per athlete.
 * The page's default (no ?athlete=) is the active athlete of the switcher;
 * an explicit choice here applies to this page only.
 */
export function AthleteFilterBar({ athletes, filter, basePath, params, t, allowAll = true }: {
  athletes: { id: string; firstName: string }[];
  filter: AthleteFilter;
  basePath: string;
  /** Other query params of the page to keep. */
  params?: Record<string, string | null | undefined>;
  t: Translator;
  allowAll?: boolean;
}) {
  if (athletes.length < 2) return null;
  const href = (athlete: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
    q.set("athlete", athlete);
    return `${basePath}?${q.toString()}`;
  };
  const item = (id: string, label: string, on: boolean) => (
    <Link key={id} href={href(id) as never} aria-current={on ? "page" : undefined} scroll={false}
      className={cn("shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm transition-colors",
        on ? "bg-brand-primary-soft text-text" : "text-text-muted hover:text-text")}>
      {label}
    </Link>
  );
  return (
    <nav aria-label={t("myAthletes.filter.label")} className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
      {allowAll && item(ALL_ATHLETES, t("myAthletes.filter.all"), filter.mode === "all")}
      {athletes.map((a) => item(a.id, a.firstName, filter.mode === "one" && filter.athleteId === a.id))}
    </nav>
  );
}

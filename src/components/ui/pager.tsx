import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Previous / next links for a server-paged list. Keeps the other query
 * parameters (filters, search) and only changes `page`.
 */
export async function Pager({ basePath, params, page, hasMore }: { basePath: string; params: Record<string, string | undefined>; page: number; hasMore: boolean }) {
  if (page <= 1 && !hasMore) return null;
  const t = await getTranslations();
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const cls = "inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-maroon/50 hover:text-ink";
  return (
    <nav className="mt-4 flex items-center justify-between gap-2" aria-label={t("common.pager.page", { page })}>
      {page > 1 ? <Link href={href(page - 1)} className={cls} rel="prev"><ChevronLeft className="h-3.5 w-3.5" /> {t("common.pager.previous")}</Link> : <span />}
      <span className="text-xs text-ink-3">{t("common.pager.page", { page })}</span>
      {hasMore ? <Link href={href(page + 1)} className={cls} rel="next">{t("common.pager.next")} <ChevronRight className="h-3.5 w-3.5" /></Link> : <span />}
    </nav>
  );
}

/** "?page=3" → 3 (1 for anything else). */
export function pageParam(v: string | undefined): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 1 && n < 100_000 ? n : 1;
}

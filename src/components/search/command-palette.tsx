"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarRange, FileText, LayoutGrid, Search, Shield, ShoppingBag, Tent, UserCircle, UserCog, Users, X, type LucideIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { globalSearch } from "@/lib/actions/search";
import { SEARCH_MIN_CHARS, type SearchHit, type SearchKind } from "@/lib/search/rank";

const ICONS: Record<SearchKind, LucideIcon> = {
  athlete: UserCircle, family: Users, coach: UserCog, program: CalendarRange, camp: Tent, team: Shield,
  invoice: FileText, product: ShoppingBag, page: LayoutGrid,
};

/**
 * Global search (Ctrl/Cmd+K or the search button). Results come from the
 * server (tenant-scoped, role-aware); arrow keys move, Enter opens, Escape
 * closes.
 */
export function CommandPalette({ className }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [active, setActive] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const reqId = React.useRef(0);
  const listId = React.useId();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
    else { setQ(""); setHits([]); setError(null); setActive(0); }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < SEARCH_MIN_CHARS) { setHits([]); setLoading(false); return; }
    const id = ++reqId.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const res = await globalSearch(term);
      if (id !== reqId.current) return;
      setLoading(false);
      if (!res.ok) { setError(res.error); setHits([]); return; }
      setError(null);
      setHits(res.hits);
      setActive(0);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [q, open]);

  function go(hit: SearchHit | undefined) {
    if (!hit) return;
    setOpen(false);
    router.push(hit.href as never);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t("search.open")} title={t("search.shortcut")}
        className={cn("touch-target inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-text-muted transition-colors hover:border-brand-primary hover:text-brand-primary focus-visible:outline-none focus-visible:shadow-focus", className)}>
        <Search className="h-4 w-4" aria-hidden />
        <span className="hidden text-xs md:inline">{t("search.placeholderShort")}</span>
        <kbd className="hidden rounded border border-border px-1 font-mono text-[10px] lg:inline">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label={t("search.title")}>
          <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-xl animate-fade-up overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                placeholder={t("search.placeholder")} maxLength={80} role="combobox" aria-expanded={hits.length > 0}
                aria-controls={listId} aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined} aria-autocomplete="list"
                className="h-12 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted" />
              <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="rounded p-1 text-text-muted hover:text-text">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <ul id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto p-1.5">
              {hits.map((h, i) => {
                const Icon = ICONS[h.kind];
                return (
                  <li key={`${h.kind}:${h.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                    onMouseEnter={() => setActive(i)} onClick={() => go(h)}
                    className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
                      i === active ? "bg-brand-primary-soft text-text" : "text-text-secondary")}>
                    <Icon className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{h.title}</span>
                      {h.subtitle && <span className="block truncate text-xs text-text-muted">{h.subtitle}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-text-muted">{t(`search.kinds.${h.kind}`)}</span>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border px-3 py-2 text-xs text-text-muted" aria-live="polite">
              {error ? <span className="text-danger">{error}</span>
                : loading ? t("search.searching")
                  : q.trim().length < SEARCH_MIN_CHARS ? t("search.hint")
                    : hits.length === 0 ? t("search.empty") : t("search.count", { count: hits.length })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

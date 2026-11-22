"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ProfileTab = { id: string; label: string; content: React.ReactNode; count?: number | null };

/**
 * Section tabs for the player profile. Panels are rendered on the server and
 * only toggled here. With `param` (admin profile) the selected tab lives in
 * the query string (?tab=membership), so other screens can link straight to
 * a tab; otherwise in the URL hash (#teams). Either way a reload or a shared
 * link lands on the same section. Scrolls horizontally on phones.
 */
export function ProfileTabs({ tabs, label, initial, param }: { tabs: ProfileTab[]; label: string; initial?: string | null; param?: string }) {
  const [active, setActive] = React.useState(
    initial && tabs.some((t) => t.id === initial) ? initial : tabs[0]?.id ?? "",
  );
  const baseId = React.useId();

  React.useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, "");
    if (fromHash && tabs.some((t) => t.id === fromHash)) setActive(fromHash);
  }, [tabs]);

  function select(id: string) {
    setActive(id);
    try {
      if (param) {
        const url = new URL(window.location.href);
        url.searchParams.set(param, id);
        url.hash = "";
        window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
      } else {
        window.history.replaceState(null, "", `#${id}`);
      }
    } catch {
      /* ignore */
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === active);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      select(next.id);
      document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id)}
              className={cn(
                "relative min-h-tap shrink-0 whitespace-nowrap px-3 text-sm transition focus-visible:shadow-focus",
                selected
                  ? "font-medium text-text after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-primary"
                  : "text-text-muted hover:text-text",
              )}
            >
              {tab.label}
              {typeof tab.count === "number" && tab.count > 0 && (
                <span className="tnum ml-1.5 rounded-full bg-surface-elevated px-1.5 text-[11px] text-text-muted">{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== active}
          className="pt-5"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}

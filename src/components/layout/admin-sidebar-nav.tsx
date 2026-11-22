"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { useTenant } from "@/lib/tenant/context";
import { NAV_TERM, termOr } from "@/lib/tenant/terms";
import type { NamespaceKey } from "@/lib/i18n/translator";
import { ADMIN_NAV_ICONS } from "./nav-config";
import { activeGroupKey, activeNavKey, type AdminNavEntry, type AdminNavModel } from "./admin-nav";

/** Nav label in the tenant's vocabulary ("Students" for a school that renamed athletes). */
export function useNavLabel() {
  const t = useT();
  const { terminology } = useTenant();
  return React.useCallback(
    (labelKey: NamespaceKey<"nav">, params?: Record<string, string>) => {
      const translated = t(`nav.${labelKey}`, params);
      const m = NAV_TERM[labelKey];
      return m ? termOr(terminology, m.key, translated, { plural: m.plural }) : translated;
    },
    [t, terminology],
  );
}

const STORAGE_PREFIX = "clubos.adminNav.open.";

function readOpen(key: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, b]) => typeof b === "boolean")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeOpen(key: string, value: Record<string, boolean>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / storage full: the menu still works, it just won't remember.
  }
}

/**
 * Admin sidebar with collapsible groups. The current page's group opens by
 * itself; the open / closed state of each group is remembered per user in
 * localStorage. Group headers are buttons (Enter / Space toggle) with
 * aria-expanded + aria-controls.
 */
export function AdminSidebarNav(props: { model: AdminNavModel; userId: string; onNavigate?: () => void }) {
  // useSearchParams (which division entry is current) needs a Suspense
  // boundary; meanwhile the same menu renders matching on the path only.
  return (
    <React.Suspense fallback={<GroupedNav {...props} params={null} />}>
      <GroupedNavWithParams {...props} />
    </React.Suspense>
  );
}

function GroupedNavWithParams(props: { model: AdminNavModel; userId: string; onNavigate?: () => void }) {
  const params = useSearchParams();
  return <GroupedNav {...props} params={params} />;
}

function GroupedNav({
  model,
  userId,
  onNavigate,
  params,
}: {
  model: AdminNavModel;
  userId: string;
  onNavigate?: () => void;
  params: { get(name: string): string | null } | null;
}) {
  const pathname = usePathname();
  const t = useT();
  const navLabel = useNavLabel();
  const idBase = React.useId();
  const storageKey = `${STORAGE_PREFIX}${userId}`;
  const activeKey = activeNavKey(model, pathname, params);
  const activeGroup = activeGroupKey(model, pathname, params);

  // Server render and first client render: only the current page's group open.
  const [open, setOpen] = React.useState<Record<string, boolean>>(() => (activeGroup ? { [activeGroup]: true } : {}));

  // After mount (and on every page change): remembered state + the current group open.
  React.useEffect(() => {
    const stored = readOpen(storageKey);
    const next = activeGroup ? { ...stored, [activeGroup]: true } : stored;
    setOpen(next);
    if (activeGroup && stored[activeGroup] !== true) writeOpen(storageKey, next);
  }, [storageKey, activeGroup]);

  const toggle = (key: string) => {
    setOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      writeOpen(storageKey, next);
      return next;
    });
  };

  const item = (e: AdminNavEntry) => {
    const active = e.key === activeKey;
    const Icon = ADMIN_NAV_ICONS[e.icon] ?? Circle;
    const label = e.text ?? (e.labelKey ? navLabel(e.labelKey, e.labelParams) : "");
    return (
      <li key={e.key}>
        <Link
          href={e.href as never}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            "touch-target group relative flex items-center gap-[11px] rounded-md px-3.5 py-[9px] text-[13.5px] transition-colors duration-150",
            "focus-visible:outline-none focus-visible:shadow-focus",
            active
              ? "bg-gradient-to-r from-brand-primary-soft to-transparent font-medium text-brand-primary rtl:bg-gradient-to-l"
              : "text-text-secondary hover:bg-surface hover:text-text",
          )}
        >
          {active && (
            <span aria-hidden className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-brand-primary shadow-glow" />
          )}
          <Icon
            aria-hidden
            className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-brand-primary" : "text-text-muted group-hover:text-brand-primary")}
          />
          <span className="min-w-0 truncate">{label}</span>
          {e.locked && (
            <span className="ms-auto rounded-full border border-brand-accent/40 bg-brand-accent-soft px-1.5 py-px text-[10.5px] font-medium text-brand-accent">
              {t("upgrades.badge")}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      {model.pinned.length > 0 && <ul className="flex flex-col gap-0.5">{model.pinned.map(item)}</ul>}
      {model.groups.map((g) => {
        const isOpen = !!open[g.key];
        const listId = `${idBase}-${g.key}`;
        const GroupIcon = ADMIN_NAV_ICONS[g.icon] ?? Circle;
        const holdsActive = g.key === activeGroup;
        return (
          <div key={g.key} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggle(g.key)}
              aria-expanded={isOpen}
              aria-controls={listId}
              className={cn(
                "touch-target group flex w-full items-center gap-[11px] rounded-md px-3.5 py-2 text-start text-[11.5px] font-medium uppercase tracking-[0.12em] transition-colors duration-150",
                "focus-visible:outline-none focus-visible:shadow-focus",
                holdsActive ? "text-text" : "text-text-muted hover:bg-surface hover:text-text",
              )}
            >
              <GroupIcon aria-hidden className={cn("h-4 w-4 shrink-0", holdsActive ? "text-brand-primary" : "text-text-muted group-hover:text-brand-primary")} />
              <span className="min-w-0 flex-1 truncate">{navLabel(g.labelKey)}</span>
              <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-150", isOpen ? "rotate-0" : "-rotate-90 rtl:rotate-90")} />
            </button>
            {/* `hidden` class too: a display utility would otherwise beat the attribute. */}
            <ul id={listId} hidden={!isOpen} className={cn("flex-col gap-0.5 ps-2", isOpen ? "flex" : "hidden")}>
              {g.items.map(item)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

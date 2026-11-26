"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, Repeat } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { switchMode } from "@/lib/actions/role-mode";
import { type AppMode, modeLabelKey } from "@/lib/auth/modes";
import type { AppRole } from "@/lib/auth/roles";
import { hasUnsavedChanges, installUnsavedTracker, markClean } from "@/lib/ui/unsaved-changes";
import { cn } from "@/lib/utils";

/**
 * Header mode selector for people holding several roles (Admin / Coach /
 * Parent). Shows the active mode; picking another one asks first when the page
 * has unsaved changes, switches on the server (stored + enforced by the
 * database), then loads the new mode's dashboard with a full page load so no
 * data of the previous mode stays in the browser.
 */
export function RoleModeSwitcher({ modes, mode, roles, className }: {
  modes: AppMode[]; mode: AppMode | null; roles: AppRole[]; className?: string;
}) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<AppMode | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => { installUnsavedTracker(); }, []);
  React.useEffect(() => { markClean(); setOpen(false); }, [pathname]);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  if (modes.length < 2 || !mode) return null;
  const label = (m: AppMode) => t(`roleMode.modes.${modeLabelKey(m, roles)}`);

  async function go(target: AppMode) {
    setBusy(true); setError(null);
    const res = await switchMode(target);
    if (!res.ok) { setBusy(false); setError(res.error); return; }
    markClean();
    // Full navigation: the previous mode's data never renders in the new one.
    window.location.assign(res.href);
  }
  function pick(target: AppMode) {
    setOpen(false);
    if (target === mode) return;
    if (hasUnsavedChanges()) { setPending(target); dialogRef.current?.showModal(); return; }
    void go(target);
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} disabled={busy}
        aria-label={t("roleMode.current", { mode: label(mode) })}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-brand-primary/50 bg-brand-primary/10 px-2.5 text-[13px] font-medium text-text hover:bg-brand-primary/20 disabled:opacity-60 sm:gap-1.5 sm:px-3 sm:text-sm">
        <Repeat className="hidden h-3.5 w-3.5 text-brand-primary sm:block" aria-hidden />
        <span>{busy ? t("roleMode.switching") : label(mode)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-text-muted" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label={t("roleMode.menuLabel")}
          className="absolute left-0 top-11 z-50 min-w-[12rem] rounded-lg border border-border bg-surface-elevated p-1 shadow-lg sm:left-auto sm:right-0">
          <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wider text-text-muted">{t("roleMode.menuLabel")}</p>
          {modes.map((m) => (
            <button key={m} type="button" role="menuitemradio" aria-checked={m === mode} onClick={() => pick(m)}
              className={cn("flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-surface",
                m === mode ? "font-semibold text-text" : "text-text-secondary")}>
              <span>{label(m)}</span>
              {m === mode && <Check className="h-4 w-4 text-brand-primary" aria-hidden />}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="absolute right-0 top-11 z-50 w-64 rounded-md border border-danger/40 bg-danger-soft p-2 text-xs text-danger">{error}</p>}

      <dialog ref={dialogRef} className="w-[min(92vw,26rem)] rounded-lg border border-border bg-surface-elevated p-0 text-text backdrop:bg-black/60"
        onClose={() => setPending(null)}>
        <div className="space-y-4 p-5">
          <h2 className="font-display text-lg">{t("roleMode.unsaved.title")}</h2>
          <p className="text-sm text-text-secondary">{t("roleMode.unsaved.body", { mode: pending ? label(pending) : "" })}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => dialogRef.current?.close()}>{t("roleMode.unsaved.stay")}</Button>
            <Button variant="danger" onClick={() => { const target = pending; dialogRef.current?.close(); if (target) void go(target); }}>
              {t("roleMode.unsaved.discard")}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

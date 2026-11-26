"use client";

import * as React from "react";
import { Check, Clock, ShieldCheck, X } from "lucide-react";
import { FINAL_STATUSES, type FinalStatus, type MarkStatus } from "@/lib/attendance/types";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { cycleStatus } from "./sheet-state";

const ICON: Record<FinalStatus, React.ComponentType<{ className?: string }>> = {
  present: Check, late: Clock, excused: ShieldCheck, unexcused: X,
};
/** Selected look per status (design tokens only). */
export const STATUS_TONE: Record<FinalStatus, string> = {
  present: "border-success bg-success-soft text-success",
  late: "border-warning bg-warning-soft text-warning",
  excused: "border-info bg-info-soft text-info",
  unexcused: "border-danger bg-danger-soft text-danger",
};

/**
 * Four large status buttons for one player. A radio group: Tab enters at the
 * selected (or first) status, arrow keys move and select, Space / Enter
 * select. Thumb-sized (min 52px) on phones.
 */
export function StatusPicker({
  value, onChange, label, disabled, compact,
}: {
  value: MarkStatus;
  onChange: (status: FinalStatus) => void;
  /** Accessible name of the group (the player's name). */
  label: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const focusIndex = value === "unmarked" ? 0 : FINAL_STATUSES.indexOf(value as FinalStatus);

  function onKey(e: React.KeyboardEvent, current: FinalStatus) {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = cycleStatus(current, dir);
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}
         className={cn("grid grid-cols-4 gap-1.5 sm:gap-2", compact && "sm:max-w-md")}>
      {FINAL_STATUSES.map((s, i) => {
        const Icon = ICON[s];
        const active = value === s;
        return (
          <button
            key={s}
            ref={(el) => { refs.current[s] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(s)}
            onKeyDown={(e) => onKey(e, s)}
            className={cn(
              "flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-md border px-1 text-[11.5px] font-medium leading-tight",
              "transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:shadow-focus",
              "active:translate-y-px motion-reduce:transform-none disabled:opacity-50",
              active ? cn(STATUS_TONE[s], "border-2") : "border-border bg-surface-elevated text-text-secondary hover:border-border-strong hover:text-text",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="text-center">{t(`coachTrainings.statusShort.${s}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

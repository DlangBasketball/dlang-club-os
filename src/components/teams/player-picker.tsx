"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { filterPlayers } from "@/lib/sportsops/roster-validation";

export type PickerPlayer = { id: string; name: string };

/**
 * Type-ahead player picker (combobox): type part of a first or last name,
 * pick with the mouse or arrow keys + Enter. Accent- and case-insensitive.
 */
export function PlayerPicker({
  id,
  players,
  excludeIds,
  value,
  onChange,
  disabled,
}: {
  id: string;
  players: PickerPlayer[];
  excludeIds?: string[];
  value: PickerPlayer | null;
  onChange: (p: PickerPlayer | null) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = `${id}-list`;
  const results = React.useMemo(() => filterPlayers(players, query, excludeIds ?? [], 8), [players, query, excludeIds]);

  React.useEffect(() => setActive(0), [query]);

  function choose(p: PickerPlayer) {
    onChange(p);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  if (value) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-border bg-surface-input px-3 text-sm text-text">
        <span className="truncate font-medium">{value.name}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={t("media.roster.clearPlayer")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-surface hover:text-text focus-visible:shadow-focus"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" aria-hidden />
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={t("media.roster.searchPlayers")}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-md border border-border bg-surface-input pl-9 pr-3 text-sm text-text placeholder:text-text-subtle focus-visible:border-brand-primary focus-visible:shadow-focus"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-surface-elevated py-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-muted">{t("media.roster.noMatches")}</li>
          ) : (
            results.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${p.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer px-3 py-2 text-sm", i === active ? "bg-brand-primary-soft text-text" : "text-text-secondary")}
              >
                {p.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

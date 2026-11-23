"use client";
import * as React from "react";
import { Search, UserPlus, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { searchBookingAthletes, type AthleteHit } from "@/lib/actions/admin-booking";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Searchable athlete picker (server search, debounced) with the
 * "+ Add New Athlete" button beside it — visible on desktop and mobile.
 */
export function AthleteCombobox({ value, label, onSelect, onAddNew, disabled }: {
  value: string; label: string; disabled?: boolean;
  onSelect: (a: AthleteHit | null) => void; onAddNew: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const id = React.useId();
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<AthleteHit[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    const n = ++seq.current;
    setLoading(true);
    const h = window.setTimeout(async () => {
      const res = await searchBookingAthletes(term);
      if (n !== seq.current) return;
      setLoading(false);
      setHits(res.ok ? res.data ?? [] : []);
      setActive(0);
    }, 250);
    return () => window.clearTimeout(h);
  }, [q]);

  function pick(a: AthleteHit) {
    onSelect(a);
    setQ(""); setHits([]); setOpen(false);
  }

  return (
    <div>
      <Label htmlFor={`${id}-q`}>{t("adminBooking.form.athlete")}</Label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="relative min-w-0 flex-1">
          {value ? (
            <div className="flex h-10 items-center justify-between gap-2 rounded border border-line bg-surface-input px-3 text-sm">
              <span className="truncate text-ink">{label}</span>
              <button type="button" disabled={disabled} onClick={() => onSelect(null)} className="text-ink-3 hover:text-ink" aria-label={t("adminBooking.form.changeAthlete")}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-3" aria-hidden />
              <Input
                id={`${id}-q`} role="combobox" aria-expanded={open && hits.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
                autoComplete="off" className="pl-9" disabled={disabled} value={q} placeholder={t("adminBooking.form.athleteSearch")}
                onChange={(e) => { setQ(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => window.setTimeout(() => setOpen(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
                  else if (e.key === "Enter" && open && hits[active]) { e.preventDefault(); pick(hits[active]); }
                  else if (e.key === "Escape") setOpen(false);
                }}
              />
              {open && q.trim().length >= 2 && (
                <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-line bg-surface-card shadow-lg">
                  {loading && hits.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">{t("adminBooking.form.searching")}</li>}
                  {!loading && hits.length === 0 && (
                    <li className="px-3 py-2 text-sm text-ink-3">{t("adminBooking.form.noAthleteFound")}</li>
                  )}
                  {hits.map((a, i) => (
                    <li key={a.id} role="option" aria-selected={i === active}>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a)}
                        className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm", i === active ? "bg-surface-elevated" : "hover:bg-surface-elevated")}>
                        <span className="min-w-0 truncate text-ink">{a.firstName} {a.lastName}</span>
                        <span className="shrink-0 text-xs text-ink-3">{[a.dob ? f.date(a.dob) : null, a.familyName].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <Button type="button" variant="secondary" disabled={disabled} onClick={onAddNew} className="w-full sm:w-auto">
          <UserPlus className="h-4 w-4" /> {t("adminBooking.form.addAthlete")}
        </Button>
      </div>
    </div>
  );
}

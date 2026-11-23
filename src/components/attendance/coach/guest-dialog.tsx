"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui";
import { Input, Label } from "@/components/ui/input";
import { searchGuestCandidates, type GuestCandidate } from "@/lib/actions/coach-attendance";
import { addGuest } from "@/lib/actions/team-attendance";
import { useT } from "@/lib/i18n/client";
import { ModalDialog } from "./modal-dialog";

/** Search an existing club player and add them as a guest to this session only. */
export function GuestDialog({
  open, onClose, eventId, onAdded,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  onAdded: (name: string) => Promise<void> | void;
}) {
  const t = useT();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<GuestCandidate[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const seq = React.useRef(0);

  React.useEffect(() => {
    if (!open) { setQ(""); setResults([]); setError(null); }
  }, [open]);

  React.useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults([]); setBusy(false); return; }
    const my = ++seq.current;
    setBusy(true);
    const h = window.setTimeout(async () => {
      const r = await searchGuestCandidates({ eventId, query }).catch(() => null);
      if (my !== seq.current) return;
      setBusy(false);
      if (!r) { setError(t("coachTrainings.guests.searchFailed")); return; }
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      setResults(r.data);
    }, 300);
    return () => window.clearTimeout(h);
  }, [q, eventId, t]);

  async function add(c: GuestCandidate) {
    setAdding(c.athleteId);
    setError(null);
    const r = await addGuest({ eventId, athleteId: c.athleteId }).catch(() => null);
    setAdding(null);
    if (!r) { setError(t("coachTrainings.guests.addFailed")); return; }
    if (!r.ok) { setError(r.error); return; }
    onClose();
    await onAdded(`${c.firstName} ${c.lastName}`);
  }

  return (
    <ModalDialog open={open} onClose={onClose} title={t("coachTrainings.guests.title")}>
      <p className="mb-4 text-sm text-text-secondary">{t("coachTrainings.guests.hint")}</p>
      <Label htmlFor="guest-search">{t("coachTrainings.guests.search")}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <Input id="guest-search" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder={t("coachTrainings.guests.searchPlaceholder")} className="h-12 pl-9" maxLength={80}
               aria-describedby="guest-search-status" />
      </div>
      <p id="guest-search-status" role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-xs text-text-muted">
        {busy ? t("coachTrainings.guests.searching")
          : q.trim().length >= 2 && results.length === 0 && !error ? t("coachTrainings.guests.noResults") : ""}
      </p>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      <ul className="max-h-[50dvh] space-y-1.5 overflow-y-auto">
        {results.map((c) => (
          <li key={c.athleteId} className="flex items-center gap-3 rounded-md border border-border bg-surface-elevated p-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-text">{c.firstName} {c.lastName}</p>
              {c.teams.length > 0 && <p className="truncate text-xs text-text-muted">{c.teams.join(", ")}</p>}
            </div>
            <Button type="button" size="md" onClick={() => add(c)} disabled={adding !== null}
                    aria-label={t("coachTrainings.guests.addNamed", { name: `${c.firstName} ${c.lastName}` })}>
              {adding === c.athleteId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("coachTrainings.guests.addShort")}
            </Button>
          </li>
        ))}
      </ul>
    </ModalDialog>
  );
}

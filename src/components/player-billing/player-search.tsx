"use client";

import * as React from "react";
import { Search, UserPlus } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { createPlayer, searchPayers, searchPlayers, type PayerHit, type PlayerHit } from "@/lib/actions/player-directory";

/**
 * Find a player in the club directory (name words or birth year). Shows the
 * matches first; only when nothing fits can an admin create the player
 * (`allowCreate`), which avoids duplicates.
 */
export function PlayerSearch({ onSelect, allowCreate = false, autoFocus = false }: {
  onSelect: (hit: PlayerHit) => void; allowCreate?: boolean; autoFocus?: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const id = React.useId();
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<PlayerHit[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [np, setNp] = React.useState({ firstName: "", lastName: "", dob: "", guardianName: "", guardianEmail: "", guardianPhone: "" });

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    const res = await searchPlayers(q.trim());
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setHits(res.data);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createPlayer(np);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setCreating(false);
    onSelect(res.data);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={run} role="search" className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Label htmlFor={`${id}-q`}>{t("playerBilling.search.label")}</Label>
          <Input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("playerBilling.search.placeholder")} autoFocus={autoFocus} />
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !q.trim()}><Search className="h-4 w-4" aria-hidden /> {t("common.search")}</Button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {hits && (
        hits.length === 0 ? (
          <p className="text-sm text-text-muted">{t("playerBilling.search.none")}</p>
        ) : (
          <ul className="divide-y divide-border-soft rounded-md border border-border" aria-label={t("playerBilling.search.results")}>
            {hits.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text">{h.name}</span>
                  <span className="block text-xs text-text-muted">{[h.dob ? f.date(h.dob) : null, h.familyName].filter(Boolean).join(" · ")}</span>
                </span>
                <Button type="button" size="sm" variant="secondary" onClick={() => onSelect(h)}>{t("playerBilling.search.choose")}</Button>
              </li>
            ))}
          </ul>
        )
      )}
      {allowCreate && hits && !creating && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(true)}><UserPlus className="h-4 w-4" aria-hidden /> {t("playerBilling.search.createNew")}</Button>
      )}
      {allowCreate && creating && (
        <form onSubmit={create} className="space-y-3 rounded-md border border-border bg-surface-elevated p-3">
          <p className="text-xs text-text-muted">{t("playerBilling.search.createHint")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor={`${id}-fn`}>{t("playerBilling.search.firstName")}</Label><Input id={`${id}-fn`} required value={np.firstName} onChange={(e) => setNp({ ...np, firstName: e.target.value })} /></div>
            <div><Label htmlFor={`${id}-ln`}>{t("playerBilling.search.lastName")}</Label><Input id={`${id}-ln`} required value={np.lastName} onChange={(e) => setNp({ ...np, lastName: e.target.value })} /></div>
            <div><Label htmlFor={`${id}-dob`}>{t("playerBilling.search.dob")}</Label><Input id={`${id}-dob`} type="date" required value={np.dob} onChange={(e) => setNp({ ...np, dob: e.target.value })} /></div>
            <div><Label htmlFor={`${id}-gn`}>{t("playerBilling.search.guardianName")}</Label><Input id={`${id}-gn`} required value={np.guardianName} onChange={(e) => setNp({ ...np, guardianName: e.target.value })} /></div>
            <div><Label htmlFor={`${id}-ge`}>{t("playerBilling.search.guardianEmail")}</Label><Input id={`${id}-ge`} type="email" value={np.guardianEmail} onChange={(e) => setNp({ ...np, guardianEmail: e.target.value })} /></div>
            <div><Label htmlFor={`${id}-gp`}>{t("playerBilling.search.guardianPhone")}</Label><Input id={`${id}-gp`} value={np.guardianPhone} onChange={(e) => setNp({ ...np, guardianPhone: e.target.value })} /></div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>{t("playerBilling.search.createSubmit")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Find a payer (family) by family / contact / player name. */
export function PayerSearch({ onSelect, autoFocus = false }: { onSelect: (hit: PayerHit) => void; autoFocus?: boolean }) {
  const t = useT();
  const id = React.useId();
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<PayerHit[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    const res = await searchPayers(q.trim());
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setHits(res.data);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={run} role="search" className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Label htmlFor={`${id}-q`}>{t("playerBilling.record.payerSearch")}</Label>
          <Input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("playerBilling.record.payerPlaceholder")} autoFocus={autoFocus} />
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !q.trim()}><Search className="h-4 w-4" aria-hidden /> {t("common.search")}</Button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {hits && (hits.length === 0 ? <p className="text-sm text-text-muted">{t("playerBilling.search.none")}</p> : (
        <ul className="divide-y divide-border-soft rounded-md border border-border">
          {hits.map((h) => (
            <li key={h.familyId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{h.familyName}</span>
                <span className="block text-xs text-text-muted">{[h.contactName, h.players.join(", ")].filter(Boolean).join(" · ")}</span>
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={() => onSelect(h)}>{t("playerBilling.search.choose")}</Button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

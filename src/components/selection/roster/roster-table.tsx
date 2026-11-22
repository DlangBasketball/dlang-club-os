"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Search, UserPlus, X } from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import {
  filterRoster, parseRosterFilters, rosterFiltersActive, ROSTER_PAYMENT_FILTERS, ROSTER_STATUS_FILTERS, type PaymentStatus,
} from "@/lib/selection/arrangement";
import type { RosterEntry } from "@/lib/selection/roster";

export type RosterSeasonOption = { id: string; label: string; href: string };

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral" | "danger"> = {
  enrolled: "success", accepted: "info", waitlisted: "warning", withdrawn: "neutral",
};
const PAY_TONE: Record<PaymentStatus, "success" | "warning" | "danger" | "neutral"> = {
  paid: "success", partial: "warning", unpaid: "danger", none: "neutral",
};

/**
 * Roster of a selection programme. Filters live in the URL (shareable, back
 * button); the server already decided what the caller may see (money only
 * when `showMoney`). Empty roster and filtered-out are told apart; errors are
 * rendered by the page, never as "no players".
 */
export function RosterTable({
  entries, divisions, tournaments, seasons, currentSeasonId, playerHrefBase, addHref, canAdd,
}: {
  entries: RosterEntry[];
  divisions: { id: string; label: string }[];
  tournaments: { id: string; label: string }[];
  seasons: RosterSeasonOption[];
  currentSeasonId: string;
  /** Link prefix of an enrolment record (null = no link, e.g. coaches). */
  playerHrefBase: string | null;
  addHref: string | null;
  canAdd: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const filters = parseRosterFilters(Object.fromEntries(sp.entries()));
  const [q, setQ] = React.useState(filters.q);
  const rows = filterRoster(entries, filters);
  const showMoney = entries.some((e) => e.showMoney);
  const showBadge = entries.some((e) => e.paymentStatus !== null);

  const setParam = React.useCallback((key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value); else next.delete(key);
    next.set("tab", "players");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router, sp]);

  React.useEffect(() => {
    const id = setTimeout(() => { if (q.trim() !== filters.q) setParam("q", q.trim()); }, 300);
    return () => clearTimeout(id);
  }, [q, filters.q, setParam]);

  const clear = () => { setQ(""); router.replace(`${pathname}?tab=players`, { scroll: false }); };
  const money = (n: number | null, cur: string | null) => (n == null ? "—" : f.money(n, cur ?? f.currency));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem]">
          <Label htmlFor="roster-season">{t("roster.filters.season")}</Label>
          <Select id="roster-season" value={currentSeasonId} onChange={(e) => {
            const s = seasons.find((x) => x.id === e.target.value);
            if (s) router.push(s.href);
          }}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </div>
        <div className="min-w-[8rem]">
          <Label htmlFor="roster-division">{t("roster.filters.division")}</Label>
          <Select id="roster-division" value={filters.division} onChange={(e) => setParam("division", e.target.value)}>
            <option value="">{t("roster.filters.all")}</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            <option value="none">{t("roster.filters.noDivision")}</option>
          </Select>
        </div>
        <div className="min-w-[9rem]">
          <Label htmlFor="roster-tournament">{t("roster.filters.tournament")}</Label>
          <Select id="roster-tournament" value={filters.tournament} onChange={(e) => setParam("tournament", e.target.value)}>
            <option value="">{t("roster.filters.all")}</option>
            {tournaments.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            <option value="none">{t("roster.filters.noTournament")}</option>
          </Select>
        </div>
        <div className="min-w-[9rem]">
          <Label htmlFor="roster-status">{t("roster.filters.status")}</Label>
          <Select id="roster-status" value={filters.status} onChange={(e) => setParam("status", e.target.value === "active" ? "" : e.target.value)}>
            {ROSTER_STATUS_FILTERS.map((s) => <option key={s} value={s}>{t(`roster.statusFilter.${s}`)}</option>)}
          </Select>
        </div>
        {showBadge && (
          <div className="min-w-[9rem]">
            <Label htmlFor="roster-payment">{t("roster.filters.payment")}</Label>
            <Select id="roster-payment" value={filters.payment} onChange={(e) => setParam("payment", e.target.value === "all" ? "" : e.target.value)}>
              {ROSTER_PAYMENT_FILTERS.map((s) => <option key={s} value={s}>{t(`roster.paymentFilter.${s}`)}</option>)}
            </Select>
          </div>
        )}
        {showBadge && (
          <label className="flex items-center gap-2 pb-2 text-sm text-text">
            <input type="checkbox" checked={filters.overdue} onChange={(e) => setParam("overdue", e.target.checked ? "1" : "")} />
            {t("roster.filters.overdueOnly")}
          </label>
        )}
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="roster-q">{t("roster.filters.search")}</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <Input id="roster-q" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("roster.filters.searchPlaceholder")} />
          </div>
        </div>
        {rosterFiltersActive(filters) && (
          <Button type="button" variant="ghost" size="sm" onClick={clear}><X className="h-4 w-4" /> {t("roster.filters.clear")}</Button>
        )}
        {canAdd && addHref && (
          <Link href={addHref} className="ml-auto"><Button size="sm"><UserPlus className="h-4 w-4" /> {t("roster.add.button")}</Button></Link>
        )}
      </div>

      <p className="text-xs text-text-muted" aria-live="polite">{t("roster.count", { shown: rows.length, total: entries.length })}</p>

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-secondary">{t("roster.empty")}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-secondary">
          {t("roster.noMatch")} <button type="button" className="text-brand-primary hover:underline" onClick={clear}>{t("roster.filters.clear")}</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-surface-elevated text-left text-[11px] uppercase tracking-[0.1em] text-text-muted">
              <tr>
                <th className="px-3 py-2">{t("roster.cols.player")}</th>
                <th className="px-3 py-2">{t("roster.cols.division")}</th>
                <th className="px-3 py-2">{t("roster.cols.tournaments")}</th>
                <th className="px-3 py-2">{t("roster.cols.status")}</th>
                {showMoney && <th className="px-3 py-2">{t("roster.cols.arrangement")}</th>}
                {showMoney && <th className="px-3 py-2 text-right">{t("roster.cols.fee")}</th>}
                {showMoney && <th className="px-3 py-2 text-right">{t("roster.cols.received")}</th>}
                {showMoney && <th className="px-3 py-2 text-right">{t("roster.cols.balance")}</th>}
                {showMoney && <th className="px-3 py-2">{t("roster.cols.nextDue")}</th>}
                {showBadge && <th className="px-3 py-2">{t("roster.cols.payment")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const href = playerHrefBase ? `${playerHrefBase}${r.id}` : null;
                const covered = r.tournaments.filter((x) => x.status === "covered");
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      {href ? <Link href={href} className="font-medium text-text hover:underline">{r.name}</Link> : <span className="font-medium text-text">{r.name}</span>}
                      <span className="block text-xs text-text-muted">
                        {r.birthYear ?? "—"}{r.jerseyNumber != null ? ` · #${r.jerseyNumber}` : ""}
                      </span>
                      {r.registrationOk === false && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-warning"><AlertTriangle className="h-3 w-3" /> {t("roster.health.rowMissing")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text">{r.divisionName ?? "—"}</td>
                    <td className="px-3 py-2 text-text">
                      {covered.length ? covered.map((x) => x.name).join(", ") : <span className="text-text-muted">{t("roster.tournamentsNotAssigned")}</span>}
                      {r.tournamentsRequired != null && covered.length !== r.tournamentsRequired && covered.length > 0 && (
                        <span className="block text-xs text-warning">{t("roster.tournamentsOf", { count: covered.length, required: r.tournamentsRequired })}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{t.dynamic(`selection.statuses.${r.status}`, undefined, r.status)}</Badge>
                      {r.status === "withdrawn" && r.withdrawnAt && <span className="block text-xs text-text-muted">{f.date(r.withdrawnAt)}</span>}
                      {r.status === "accepted" && href && (
                        <Link href={href} className="mt-1 block text-xs text-brand-primary hover:underline">{t("roster.nextStep")}</Link>
                      )}
                    </td>
                    {showMoney && (
                      <td className="px-3 py-2 text-text">
                        {r.arrangementKind === "monthly" && r.monthlyAmount != null
                          ? t("roster.arrangement.monthlyShort", { amount: money(r.monthlyAmount, r.currency), count: r.installmentCount ?? 0 })
                          : r.arrangementKind === "full" ? t("roster.arrangement.fullShort") : <span className="text-text-muted">{t("roster.arrangement.none")}</span>}
                      </td>
                    )}
                    {showMoney && <td className="px-3 py-2 text-right tnum">{money(r.amountDue ?? r.agreedFee, r.currency)}</td>}
                    {showMoney && <td className="px-3 py-2 text-right tnum">{money(r.received, r.currency)}</td>}
                    {showMoney && <td className="px-3 py-2 text-right tnum">{money(r.balance, r.currency)}</td>}
                    {showMoney && <td className="px-3 py-2 tnum">{r.nextDueOn ? f.date(r.nextDueOn) : "—"}</td>}
                    {showBadge && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.paymentStatus && <Badge tone={PAY_TONE[r.paymentStatus]}>{t(`roster.paymentStatus.${r.paymentStatus}`)}</Badge>}
                          {r.overdue && <Badge tone="danger" dot>{t("roster.overdue")}</Badge>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

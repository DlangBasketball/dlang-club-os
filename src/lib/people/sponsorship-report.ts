import { fromMinorUnits, toMinorUnits } from "@/lib/payments/currency";

/**
 * Sponsorship report (pure): totals of the value given per player, per
 * sponsor and overall, per currency, from public.athlete_sponsorship_entries.
 */
export type SponsorshipEntry = {
  id: string;
  athleteId: string;
  playerName: string;
  sponsorName: string | null;
  scope: string;
  method: string;
  percent: number;
  listAmount: number;
  amount: number;
  currency: string;
  date: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export type SponsorshipTotal = { key: string; label: string | null; currency: string; amount: number; count: number };
export type SponsorshipSummary = {
  byPlayer: (SponsorshipTotal & { athleteId: string })[];
  bySponsor: SponsorshipTotal[];
  totals: { currency: string; amount: number; count: number }[];
  players: number;
};

function add(map: Map<string, { minor: number; count: number }>, key: string, minor: number) {
  const cur = map.get(key) ?? { minor: 0, count: 0 };
  cur.minor += minor;
  cur.count += 1;
  map.set(key, cur);
}

export function summarizeSponsorships(entries: SponsorshipEntry[]): SponsorshipSummary {
  const player = new Map<string, { minor: number; count: number }>();
  const sponsor = new Map<string, { minor: number; count: number }>();
  const total = new Map<string, { minor: number; count: number }>();
  const names = new Map<string, string>();
  for (const e of entries) {
    const minor = toMinorUnits(e.amount, e.currency);
    add(player, `${e.athleteId}|${e.currency}`, minor);
    add(sponsor, `${(e.sponsorName ?? "").trim()}|${e.currency}`, minor);
    add(total, e.currency, minor);
    names.set(e.athleteId, e.playerName);
  }
  const split = (k: string) => {
    const i = k.lastIndexOf("|");
    return [k.slice(0, i), k.slice(i + 1)] as const;
  };
  const byAmount = (a: SponsorshipTotal, b: SponsorshipTotal) => b.amount - a.amount || (a.label ?? "").localeCompare(b.label ?? "");
  return {
    byPlayer: Array.from(player, ([k, v]) => {
      const [athleteId, currency] = split(k);
      return { key: k, athleteId, label: names.get(athleteId) ?? null, currency, amount: fromMinorUnits(v.minor, currency), count: v.count };
    }).sort(byAmount),
    bySponsor: Array.from(sponsor, ([k, v]) => {
      const [name, currency] = split(k);
      return { key: k, label: name || null, currency, amount: fromMinorUnits(v.minor, currency), count: v.count };
    }).sort(byAmount),
    totals: Array.from(total, ([currency, v]) => ({ currency, amount: fromMinorUnits(v.minor, currency), count: v.count }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    players: new Set(entries.map((e) => e.athleteId)).size,
  };
}

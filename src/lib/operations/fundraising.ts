/**
 * Pure fundraising maths (no I/O). Amounts are summed in minor units so
 * 0.1 + 0.2 style float errors never show on a progress bar or a receipt.
 */
export type DonationLike = {
  amount: number;
  currency: string;
  status: "received" | "refunded";
  donorId: string | null;
  donatedOn: string; // "YYYY-MM-DD"
};

const toMinor = (v: number) => Math.round(v * 100);
const fromMinor = (v: number) => v / 100;

export type CampaignProgress = {
  raised: number;
  goal: number;
  remaining: number;
  /** 0-100+, one decimal (can exceed 100 when the goal is beaten). */
  percent: number;
  /** 0-100 for a progress bar. */
  barPercent: number;
  donationCount: number;
  donorCount: number;
  reached: boolean;
};

/**
 * Progress of a campaign towards its goal. Only received donations in the
 * campaign currency count (refunds and other currencies are ignored);
 * gifts without a donor record each count as one donor.
 */
export function campaignProgress(goal: number, currency: string, donations: DonationLike[]): CampaignProgress {
  const cur = currency.toUpperCase();
  const counted = donations.filter((d) => d.status === "received" && d.currency.toUpperCase() === cur && d.amount > 0);
  const raisedMinor = counted.reduce((s, d) => s + toMinor(d.amount), 0);
  const goalMinor = Math.max(toMinor(goal), 0);
  const donors = new Set<string>();
  let unknown = 0;
  for (const d of counted) {
    if (d.donorId) donors.add(d.donorId);
    else unknown += 1;
  }
  const percent = goalMinor > 0 ? Math.round((raisedMinor / goalMinor) * 1000) / 10 : 0;
  return {
    raised: fromMinor(raisedMinor),
    goal: fromMinor(goalMinor),
    remaining: fromMinor(Math.max(goalMinor - raisedMinor, 0)),
    percent,
    barPercent: Math.min(Math.max(percent, 0), 100),
    donationCount: counted.length,
    donorCount: donors.size + unknown,
    reached: goalMinor > 0 && raisedMinor >= goalMinor,
  };
}

export type DonorYearTotal = { donorId: string; currency: string; total: number; count: number; dates: string[] };

/** Received donations of one calendar year, per donor and currency (annual receipts). */
export function donorYearTotals(donations: DonationLike[], year: number): DonorYearTotal[] {
  const map = new Map<string, { donorId: string; currency: string; minor: number; count: number; dates: string[] }>();
  for (const d of donations) {
    if (!d.donorId || d.status !== "received" || !d.donatedOn.startsWith(`${year}-`)) continue;
    const key = `${d.donorId}:${d.currency.toUpperCase()}`;
    const row = map.get(key) ?? { donorId: d.donorId, currency: d.currency.toUpperCase(), minor: 0, count: 0, dates: [] };
    row.minor += toMinor(d.amount);
    row.count += 1;
    row.dates.push(d.donatedOn);
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ donorId: r.donorId, currency: r.currency, total: fromMinor(r.minor), count: r.count, dates: r.dates.sort() }))
    .sort((a, b) => b.total - a.total);
}

/** Is a campaign open for gifts on `todayKey`? */
export function campaignOpen(c: { status: string; startsOn: string | null; endsOn: string | null }, todayKey: string): boolean {
  if (c.status !== "active") return false;
  if (c.startsOn && todayKey < c.startsOn) return false;
  return !(c.endsOn && todayKey > c.endsOn);
}

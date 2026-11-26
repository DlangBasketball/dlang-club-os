/**
 * Carpool matching suggestions (pure, unit-tested). The database enforces
 * the hard rules (same event, open, enough seats, different families); this
 * only ranks which open offer suits an open request best.
 */
export type OfferLite = { id: string; fromArea: string; seatsTotal: number; seatsTaken: number; returnTrip: boolean; status: string; mine?: boolean };
export type RequestLite = { id: string; fromArea: string; seatsNeeded: number; returnTrip: boolean; status: string; mine?: boolean };
export type Suggestion = { offerId: string; requestId: string; score: number };

/** Lower-case words of an area name, accents removed ("Lausanne-Gare" -> lausanne, gare). */
export function areaTokens(area: string): string[] {
  return area
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

/** 0..1 overlap of two area names (Jaccard on words). */
export function areaSimilarity(a: string, b: string): number {
  const x = new Set(areaTokens(a));
  const y = new Set(areaTokens(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both);
}

export function seatsLeft(o: Pick<OfferLite, "seatsTotal" | "seatsTaken">): number {
  return Math.max(0, o.seatsTotal - o.seatsTaken);
}

/**
 * Best offer per open request: enough free seats, never the same person,
 * a return-trip request prefers a return-trip offer, then the closest area,
 * then the tightest fit (keeps big cars for big requests).
 */
export function suggestMatches(offers: OfferLite[], requests: RequestLite[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const r of requests) {
    if (r.status !== "open") continue;
    let best: Suggestion | null = null;
    for (const o of offers) {
      if (o.status !== "open" || (o.mine && r.mine)) continue;
      const left = seatsLeft(o);
      if (left < r.seatsNeeded) continue;
      const score =
        areaSimilarity(o.fromArea, r.fromArea) * 10 +
        (r.returnTrip ? (o.returnTrip ? 3 : -3) : 0) -
        (left - r.seatsNeeded) * 0.5;
      if (!best || score > best.score) best = { offerId: o.id, requestId: r.id, score: Math.round(score * 100) / 100 };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score);
}

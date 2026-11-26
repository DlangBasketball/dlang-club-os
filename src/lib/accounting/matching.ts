/**
 * Matching incoming bank credits to open invoices. Pure.
 *
 *   1. Structured reference (QRR / SCOR) equal to the invoice's payment
 *      reference -> "reference" match (score 100). Instalment slips carry the
 *      invoice's reference, so they match the invoice too; the payment is then
 *      allocated to the earliest open instalment by the database.
 *   2. Otherwise a heuristic score, same currency only:
 *        invoice number in the remittance text   +60
 *        amount = open balance                    +40
 *        amount = an open instalment              +35
 *        debtor name shares a word with the family name  +30
 *      The best candidate becomes a SUGGESTION when it scores >= 60 and beats
 *      the runner-up by >= 10. Suggestions are never booked automatically.
 * The database re-derives reference matches itself and re-checks every
 * suggested invoice (same club, payable, same currency).
 */
import { normalizeReference } from "./references";

export type OpenInvoice = {
  id: string;
  number: string;
  familyName: string | null;
  reference: string | null;
  currency: string;
  balance: number;
  /** Outstanding amounts of open instalments (instalment plans). */
  instalments?: number[];
};

export type CreditToMatch = {
  amount: number;
  currency: string;
  reference: string | null;
  debtorName: string | null;
  remittance: string | null;
};

export type MatchKind = "reference" | "heuristic";
export type MatchResult = { invoiceId: string | null; kind: MatchKind | null; score: number };

export const SUGGEST_THRESHOLD = 60;
export const SUGGEST_MARGIN = 10;

// Words that say nothing about who paid.
const STOP = new Set([
  "family", "famille", "familie", "famiglia", "familia", "fam", "and", "et", "und", "e", "y", "the", "de", "la", "le",
  "von", "van", "der", "di", "da", "du", "des", "herr", "frau", "mr", "mrs", "ms", "m", "mme", "sig", "sra", "sr",
]);

export function nameTokens(s: string | null | undefined): Set<string> {
  const plain = (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return new Set(plain.split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w)));
}

export function namesOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = nameTokens(a);
  if (!ta.size) return false;
  for (const w of nameTokens(b)) if (ta.has(w)) return true;
  return false;
}

const cents = (n: number) => Math.round(n * 100);

function mentionsNumber(text: string | null, number: string): boolean {
  if (!text || !number) return false;
  const esc = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z])${esc}($|[^0-9A-Za-z])`, "i").test(text);
}

export function heuristicScore(c: CreditToMatch, inv: OpenInvoice): number {
  if (inv.currency.toUpperCase() !== c.currency.toUpperCase() || inv.balance <= 0) return 0;
  let score = 0;
  if (mentionsNumber(c.remittance, inv.number)) score += 60;
  const amt = cents(c.amount);
  if (amt === cents(inv.balance)) score += 40;
  else if ((inv.instalments ?? []).some((x) => cents(x) === amt)) score += 35;
  if (namesOverlap(c.debtorName, inv.familyName)) score += 30;
  return score;
}

/** Match one credit against the open invoices of the club. */
export function matchCredit(c: CreditToMatch, invoices: OpenInvoice[]): MatchResult {
  const ref = normalizeReference(c.reference);
  if (ref) {
    const hit = invoices.find((i) => i.reference && normalizeReference(i.reference) === ref
      && i.currency.toUpperCase() === c.currency.toUpperCase());
    if (hit) return { invoiceId: hit.id, kind: "reference", score: 100 };
  }
  let best: { id: string; score: number } | null = null;
  let second = 0;
  for (const inv of invoices) {
    const s = heuristicScore(c, inv);
    if (s <= 0) continue;
    if (!best || s > best.score) { second = best?.score ?? 0; best = { id: inv.id, score: s }; }
    else if (s > second) second = s;
  }
  if (best && best.score >= SUGGEST_THRESHOLD && best.score - second >= SUGGEST_MARGIN) {
    return { invoiceId: best.id, kind: "heuristic", score: Math.min(best.score, 99) };
  }
  return { invoiceId: null, kind: null, score: best?.score ?? 0 };
}

/** Match a batch; one invoice gets at most one heuristic suggestion per batch (largest score wins). */
export function matchCredits(credits: CreditToMatch[], invoices: OpenInvoice[]): MatchResult[] {
  const out = credits.map((c) => matchCredit(c, invoices));
  const claimed = new Map<string, number>();
  out.forEach((r, i) => {
    if (r.kind !== "heuristic" || !r.invoiceId) return;
    const prev = claimed.get(r.invoiceId);
    if (prev === undefined) { claimed.set(r.invoiceId, i); return; }
    const keep = out[prev].score >= r.score ? prev : i;
    const drop = keep === prev ? i : prev;
    out[drop] = { invoiceId: null, kind: null, score: out[drop].score };
    claimed.set(r.invoiceId, keep);
  });
  return out;
}

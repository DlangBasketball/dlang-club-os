/**
 * Split billing math (pure). Mirrors public.split_family_invoice():
 * every payer but the last gets round(amount * pct / 100) in the currency's
 * minor unit; the last payer gets the remainder, so the parts always add up
 * exactly to the original amount. Lines are split the same way, line by line.
 *
 * Design choice (documented in docs/family/FAMILY_AND_MULTI_CLUB.md): a family invoice
 * is split into one ordinary invoice per paying guardian. Each part keeps the
 * whole invoice model (number, QR / creditor reference, Stripe link,
 * reminders, reconciliation, credit notes) instead of adding "payer shares"
 * inside one invoice, which the QR-bill (one amount + one reference per
 * payment part) cannot express.
 */

export type Share = { profileId: string; pct: number };

/** Minor-unit exponent (CHF/EUR/USD 2, JPY 0, ...). */
export function exponentFor(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Round half away from zero, like Postgres round(numeric, n). */
export function roundTo(value: number, exp: number): number {
  const f = 10 ** exp;
  const scaled = Math.abs(value) * f;
  // Guard against binary noise (e.g. 1.005 * 100 = 100.49999...).
  const r = Math.round(scaled + 1e-9);
  return (Math.sign(value) * r) / f;
}

/** Amount per payer; parts sum exactly to `amount`. */
export function splitAmount(amount: number, pcts: number[], exp = 2): number[] {
  if (pcts.length === 0) return [];
  const f = 10 ** exp;
  const totalMinor = Math.round(amount * f);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < pcts.length; i++) {
    if (i < pcts.length - 1) {
      const part = Math.round(roundTo((totalMinor / f) * (pcts[i] as number) / 100, exp) * f);
      acc += part;
      out.push(part / f);
    } else {
      out.push((totalMinor - acc) / f);
    }
  }
  return out;
}

export type Line = { description: string; quantity: number; amount: number };

/** Lines per payer (index-aligned with `pcts`). */
export function splitLines(lines: Line[], pcts: number[], exp = 2): Line[][] {
  const parts: Line[][] = pcts.map(() => []);
  for (const line of lines) {
    const amounts = splitAmount(line.amount, pcts, exp);
    amounts.forEach((a, i) => parts[i]!.push({ ...line, amount: a }));
  }
  return parts;
}

export type ShareProblem = "TOTAL" | "TWO_PAYERS" | "RANGE" | "DUPLICATE";

/** Validates a split before it is sent to the database (same rules). */
export function validateShares(shares: Share[]): ShareProblem | null {
  const ids = new Set<string>();
  let total = 0;
  let payers = 0;
  for (const s of shares) {
    if (!Number.isFinite(s.pct) || s.pct < 0 || s.pct > 100) return "RANGE";
    if (ids.has(s.profileId)) return "DUPLICATE";
    ids.add(s.profileId);
    total += Math.round(s.pct * 100);
    if (s.pct > 0) payers += 1;
  }
  if (total !== 100 * 100) return "TOTAL";
  if (payers < 2) return "TWO_PAYERS";
  return null;
}

/** Even split (e.g. 50/50, 33.34/33.33/33.33) with the remainder on the first payer. */
export function evenShares(profileIds: string[]): Share[] {
  const n = profileIds.length;
  if (n === 0) return [];
  const base = Math.floor(10000 / n) / 100;
  const first = Math.round((100 - base * (n - 1)) * 100) / 100;
  return profileIds.map((profileId, i) => ({ profileId, pct: i === 0 ? first : base }));
}

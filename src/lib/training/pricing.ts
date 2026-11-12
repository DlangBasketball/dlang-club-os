/**
 * Package and credit math for the training system. Pure: shared by the UI,
 * the server actions and the unit tests. Amounts are rounded to the
 * currency's minor unit with Intl (CHF/EUR/USD: 2 decimals, JPY: 0).
 *
 * The database is authoritative for what is charged (it re-reads prices and
 * applies public.training_purchase_discount()); these helpers only explain
 * prices and balances on screen.
 */

export type PackageOption = { id: string; sessions: number; price: number; validityDays: number | null; isActive?: boolean };
export type CreditLot = {
  sessions: number;
  sessionsUsed: number;
  status: "pending" | "active" | "cancelled";
  expiresAt: string | null;
};

export function minorUnits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function roundMoney(amount: number, currency: string): number {
  const f = 10 ** minorUnits(currency);
  return Math.round((amount + Number.EPSILON) * f) / f;
}

/** Price of one session inside a package. */
export function perSessionPrice(pkg: Pick<PackageOption, "sessions" | "price">, currency: string): number {
  if (!pkg.sessions || pkg.sessions <= 0) return 0;
  return roundMoney(pkg.price / pkg.sessions, currency);
}

/** What the package saves against buying the sessions one by one (never negative). */
export function packageSavings(pkg: Pick<PackageOption, "sessions" | "price">, singlePrice: number, currency: string): { amount: number; percent: number } {
  const full = singlePrice * pkg.sessions;
  if (full <= 0 || pkg.price >= full) return { amount: 0, percent: 0 };
  const amount = roundMoney(full - pkg.price, currency);
  return { amount, percent: Math.round(((full - pkg.price) / full) * 100) };
}

/** Active packages of a service in display order (fewest sessions first). */
export function sortPackages<T extends PackageOption>(pkgs: T[]): T[] {
  return pkgs.filter((p) => p.isActive !== false).sort((a, b) => a.sessions - b.sessions || a.price - b.price);
}

/** Expiry instant of a lot granted at `grantedAt` with `validityDays` (null = never expires). */
export function expiryFor(grantedAt: Date, validityDays: number | null): Date | null {
  if (!validityDays || validityDays <= 0) return null;
  return new Date(grantedAt.getTime() + validityDays * 864e5);
}

/** Sessions still usable now: active, not expired lots only. */
export function remainingSessions(lots: CreditLot[], now: Date): number {
  return lots.reduce((sum, l) => {
    if (l.status !== "active") return sum;
    if (l.expiresAt && Date.parse(l.expiresAt) <= now.getTime()) return sum;
    return sum + Math.max(0, l.sessions - l.sessionsUsed);
  }, 0);
}

/** Sessions bought but waiting for the invoice to be paid. */
export function pendingSessions(lots: CreditLot[]): number {
  return lots.reduce((sum, l) => (l.status === "pending" ? sum + Math.max(0, l.sessions - l.sessionsUsed) : sum), 0);
}

/** Which lot a booking consumes: the one expiring first (no expiry last). Mirrors book_training(). */
export function pickLot<T extends CreditLot & { grantedAt?: string | null }>(lots: T[], now: Date): T | null {
  const usable = lots.filter(
    (l) => l.status === "active" && l.sessionsUsed < l.sessions && (!l.expiresAt || Date.parse(l.expiresAt) > now.getTime()),
  );
  usable.sort((a, b) => {
    const ea = a.expiresAt ? Date.parse(a.expiresAt) : Infinity;
    const eb = b.expiresAt ? Date.parse(b.expiresAt) : Infinity;
    if (ea !== eb) return ea - eb;
    return (a.grantedAt ?? "").localeCompare(b.grantedAt ?? "");
  });
  return usable[0] ?? null;
}

/** Is a cancellation at `now` inside the free window (credit returned)? Mirrors cancel_training_booking(). */
export function isWithinCancellationWindow(slotStart: string, cancellationHours: number, now: Date): boolean {
  return (Date.parse(slotStart) - now.getTime()) / 36e5 >= cancellationHours;
}

/**
 * DISCOUNT EXTENSION POINT (UI preview only). The shared discounts model
 * plugs in here and in public.training_purchase_discount(); until then no
 * discount applies. Returns the amount to charge and the discount applied.
 */
export type DiscountPreview = { discountTotal: number; discountIds: string[]; amount: number };
export type DiscountResolver = (ctx: { serviceId: string; packageId: string | null; listPrice: number; currency: string }) => { total: number; ids: string[] };
export const noDiscount: DiscountResolver = () => ({ total: 0, ids: [] });

export function applyDiscount(listPrice: number, currency: string, ctx: { serviceId: string; packageId: string | null }, resolver: DiscountResolver = noDiscount): DiscountPreview {
  const d = resolver({ ...ctx, listPrice, currency });
  const discountTotal = Math.min(listPrice, Math.max(0, roundMoney(d.total, currency)));
  return { discountTotal, discountIds: d.ids, amount: roundMoney(listPrice - discountTotal, currency) };
}

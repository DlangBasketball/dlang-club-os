/**
 * Capabilities requested for Express connected accounts — pure (unit-tested).
 *
 * Standard accounts manage their own payment methods in their Stripe
 * dashboard, so nothing is requested for them. Express accounts only get what
 * the platform requests: card_payments + transfers everywhere, plus
 * twint_payments for Swiss (CH) accounts (TWINT settles in CHF only).
 *
 * STRIPE_CONNECT_REQUEST_TWINT=false switches the TWINT request off (escape
 * hatch if Stripe refuses it for the platform), see
 * docs/ops/STRIPE_CONNECT_TWINT_SETUP.md.
 */

export const TWINT_CAPABILITY = "twint_payments" as const;

export type ExpressCapabilityName = "card_payments" | "transfers" | typeof TWINT_CAPABILITY;
export type ExpressCapabilities = Partial<Record<ExpressCapabilityName, { requested: true }>>;

/** Countries whose connected accounts may take TWINT. */
const TWINT_COUNTRIES = new Set(["CH"]);

export function twintCapabilityEnabled(flag: string | null | undefined): boolean {
  const v = (flag ?? "").trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off" || v === "no");
}

export function expressCapabilities(country: string | null | undefined, opts: { requestTwint?: boolean } = {}): ExpressCapabilities {
  const caps: ExpressCapabilities = { card_payments: { requested: true }, transfers: { requested: true } };
  const cc = (country ?? "").trim().toUpperCase();
  if ((opts.requestTwint ?? true) && TWINT_COUNTRIES.has(cc)) caps[TWINT_CAPABILITY] = { requested: true };
  return caps;
}

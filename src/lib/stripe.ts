import Stripe from "stripe";

let cached: Stripe | null = null;

/** Returns a Stripe client, or null if STRIPE_SECRET_KEY isn't configured. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // Prospect demo sandboxes: never charge for real (the env check also
  // refuses a live key while DEMO_SANDBOX_ENABLED=true).
  if (process.env.DEMO_SANDBOX_ENABLED === "true" && /^(sk|rk)_live_/.test(key)) return null;
  if (!cached) cached = new Stripe(key);
  return cached;
}

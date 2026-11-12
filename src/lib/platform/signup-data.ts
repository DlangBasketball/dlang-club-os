import "server-only";
import { getPublicPlans } from "./data";
import { CURRENCIES } from "./catalog";
import type { Currency, SignupPlan, SignupValues } from "./types";

export const SALES_EMAIL = process.env.PLATFORM_SALES_EMAIL ?? "sales@example.com";

export async function getSignupPlans(): Promise<SignupPlan[]> {
  const plans = await getPublicPlans();
  return plans.map((p) => ({
    code: p.code,
    name: p.name,
    tagline: p.tagline,
    isCustom: p.is_custom,
    maxAthletes: p.max_athletes,
    prices: p.prices.map((x) => ({ currency: x.currency, interval: x.billing_interval, amount: Number(x.amount) })),
  }));
}

/** Reads the pending signup stashed in auth user_metadata by the signup form. */
export function pendingFromMetadata(meta: Record<string, unknown> | undefined | null): Partial<SignupValues> | undefined {
  const raw = meta?.pending_tenant;
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string).slice(0, 120) : undefined);
  const currency = str("currency");
  return {
    name: str("name"),
    slug: str("slug"),
    sport: str("sport"),
    country: str("country"),
    currency: currency && (CURRENCIES as string[]).includes(currency) ? (currency as Currency) : undefined,
    locale: str("locale"),
    fullName: str("fullName") ?? (typeof meta?.full_name === "string" ? (meta.full_name as string) : undefined),
    plan: str("plan"),
  };
}

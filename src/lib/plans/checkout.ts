import "server-only";
import { logError } from "@/lib/log";
import { plansAdminDb } from "./db";

export type CheckoutPlanSource = "season" | "camp" | "training_package" | "shop" | "invoice";

/**
 * After a checkout created an invoice (camp registration, shop order,
 * training package): split it into the instalments the payer chose. The org
 * was resolved server-side (slug / session) and the invoice id comes from the
 * RPC that created it, never from the client; plan_attach_checkout re-checks
 * the club's rules (enabled, product type, allowed count, minimum, camp
 * deadline). Failure never undoes the purchase: the invoice stays payable in
 * full and the reason is returned for the confirmation screen.
 */
export async function attachPlanAtCheckout(
  orgId: string, invoiceId: string | null | undefined, count: number | null | undefined, source: CheckoutPlanSource,
): Promise<{ ok: true; planId: string | null } | { ok: false; code: string }> {
  if (!invoiceId || !count || count < 2) return { ok: true, planId: null };
  const { data, error } = await plansAdminDb().rpc("plan_attach_checkout", { p_org: orgId, p_invoice: invoiceId, p_count: count, p_source: source });
  if (error) {
    const code = /\b([A-Z_]{6,})\b/.exec(error.message)?.[1] ?? "generic";
    if (code === "generic") logError("plans.attachCheckout", error, { orgId });
    return { ok: false, code };
  }
  return { ok: true, planId: ((data ?? {}) as { plan_id?: string }).plan_id ?? null };
}

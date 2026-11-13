import { createPortalSession } from "@/lib/platform/billing";
import { readBody, requireOrgAdmin, respond, sameOrigin, siteUrlFrom } from "@/lib/platform/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal
 * Opens the Stripe customer portal (invoices, payment method, plan change,
 * cancellation) for the caller's org. Org admins only.
 */
export async function POST(req: Request) {
  const { isForm } = await readBody(req);
  if (!sameOrigin(req)) return respond(req, isForm, { ok: false, status: 403, error: "Cross-origin request blocked" });

  const me = await requireOrgAdmin();
  if (!me) return respond(req, isForm, { ok: false, status: 403, error: "Only club admins can manage the subscription" });

  try {
    const result = await createPortalSession({ orgId: me.orgId, siteUrl: siteUrlFrom(req) });
    return respond(req, isForm, result);
  } catch (err) {
    console.error("[billing] portal failed:", err instanceof Error ? err.message : err);
    return respond(req, isForm, { ok: false, status: 502, error: "Could not open the billing portal. Please try again." });
  }
}

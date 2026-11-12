import { createAdminClient } from "@/lib/supabase/admin";
import { createCheckoutSession } from "@/lib/platform/billing";
import { readBody, requireOrgAdmin, respond, sameOrigin, siteUrlFrom } from "@/lib/platform/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout  { plan, interval: "month" | "year" }
 * Starts a Stripe Checkout (mode=subscription) for the caller's org.
 * Org admins only. The org and currency come from the server-side session and
 * subscription row — never from the request body.
 */
export async function POST(req: Request) {
  const { data, isForm } = await readBody(req);
  if (!sameOrigin(req)) return respond(req, isForm, { ok: false, status: 403, error: "Cross-origin request blocked" });

  const me = await requireOrgAdmin();
  if (!me) return respond(req, isForm, { ok: false, status: 403, error: "Only club admins can manage the subscription" });

  const plan = (data.plan ?? "").trim();
  const interval = data.interval === "year" ? "year" : data.interval === "month" ? "month" : null;
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(plan) || !interval) {
    return respond(req, isForm, { ok: false, status: 400, error: "Pick a plan and billing period" });
  }

  const { data: org } = await createAdminClient()
    .from("organizations")
    .select("name")
    .eq("id", me.orgId)
    .maybeSingle();

  try {
    const result = await createCheckoutSession({
      orgId: me.orgId,
      orgName: org?.name ?? "Club",
      email: me.email,
      planCode: plan,
      interval,
      siteUrl: siteUrlFrom(req),
    });
    return respond(req, isForm, result);
  } catch (err) {
    console.error("[billing] checkout failed:", err instanceof Error ? err.message : err);
    return respond(req, isForm, { ok: false, status: 502, error: "Could not start checkout. Please try again." });
  }
}

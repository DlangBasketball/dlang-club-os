import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, CreditCard, PartyPopper } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { homeForRoles } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicPlans } from "@/lib/platform/data";
import { checkLimit, getEntitlements } from "@/lib/platform/features";
import { billingConfigured } from "@/lib/platform/billing";
import { FEATURES, formatMoney } from "@/lib/platform/catalog";
import { asPlatform, type SubscriptionRow } from "@/lib/platform/types";
import { SALES_EMAIL } from "@/lib/platform/signup-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Club-facing subscription page (org admins): trial status, usage vs. plan
 * limits, plan picker -> Stripe Checkout, and the Stripe customer portal.
 * Linked from the end of signup; link it from the admin settings too.
 */
export default async function SignupPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; checkout?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const me = await getSessionUser();
  if (!me) redirect("/login?redirect=/signup/plan");
  if (!me.orgId || !me.roles.includes("admin")) redirect(me.roles.length ? homeForRoles(me.roles) : "/signup");

  const [ent, plans, athletes, staff, { data: sub }, { data: org }] = await Promise.all([
    getEntitlements(me.orgId),
    getPublicPlans(),
    checkLimit(me.orgId, "athletes", 0),
    checkLimit(me.orgId, "staff", 0),
    asPlatform(createAdminClient()).from("subscriptions").select("*").eq("org_id", me.orgId).maybeSingle(),
    createAdminClient().from("organizations").select("name").eq("id", me.orgId).maybeSingle(),
  ]);
  const s = (sub as SubscriptionRow | null) ?? null;
  const currency = s?.currency ?? "CHF";
  const stripeReady = billingConfigured();
  const paying = Boolean(s?.stripe_subscription_id) && ["active", "trialing", "past_due"].includes(s?.status ?? "");

  return (
    <div className="animate-fade-up space-y-8 pt-4">
      {sp.welcome && (
        <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-soft p-4 text-sm">
          <PartyPopper className="mt-0.5 h-5 w-5 text-success" />
          <div>
            <div className="font-medium text-ink">{org?.name ?? "Your organization"} is ready.</div>
            <div className="text-ink-2">
              Your free trial has started. Choose a plan now or any time before it ends —{" "}
              <Link href={"/admin/dashboard" as never} className="text-ink underline-offset-2 hover:underline">
                or go straight to your dashboard
              </Link>
              .
            </div>
          </div>
        </div>
      )}
      {sp.checkout === "success" && (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success-soft p-4 text-sm text-ink">
          <CheckCircle2 className="h-5 w-5 text-success" /> Thank you — your subscription is being activated. It can take a
          few seconds to appear here.
        </div>
      )}
      {sp.checkout === "cancelled" && (
        <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">Checkout cancelled — nothing was charged.</div>
      )}
      {sp.error && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">{sp.error.slice(0, 200)}</div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Subscription</h1>
          <p className="mt-1 text-sm text-ink-2">
            {ent.planName ?? "No plan"} ·{" "}
            {ent.suspended
              ? "suspended — contact support"
              : s?.status === "trialing"
                ? ent.live
                  ? `trial — ${ent.trialDaysLeft} day${ent.trialDaysLeft === 1 ? "" : "s"} left`
                  : "trial ended — choose a plan to continue"
                : (s?.status ?? "none").replace("_", " ")}
            {s?.current_period_end && s.status !== "trialing" ? ` · renews ${new Date(s.current_period_end).toLocaleDateString("en-GB")}` : ""}
            {s?.cancel_at_period_end ? " · cancels at period end" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {s?.stripe_customer_id && stripeReady && (
            <form action="/api/billing/portal" method="post">
              <Button type="submit" variant="secondary">
                <CreditCard className="h-4 w-4" /> Manage billing
              </Button>
            </form>
          )}
          <Link href={"/admin/dashboard" as never}>
            <Button variant="ghost">Dashboard</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ["Athletes", athletes],
          ["Staff", staff],
        ] as const).map(([label, l]) => (
          <div key={label} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-ink-3">{label}</span>
              <span className="tnum text-sm">
                {l.used} <span className="text-ink-3">/ {l.limit ?? "∞"}</span>
              </span>
            </div>
            {l.limit !== null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                <div
                  className={cn("h-full", l.used > l.limit ? "bg-danger" : "bg-maroon")}
                  style={{ width: `${Math.min(100, Math.max(2, (l.used / Math.max(l.limit, 1)) * 100))}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {!stripeReady && (
        <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          Online billing isn&apos;t configured on this deployment (STRIPE_BILLING_SECRET_KEY). Your trial continues;
          contact us to subscribe.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((p) => {
          const month = p.prices.find((x) => x.currency === currency && x.billing_interval === "month");
          const year = p.prices.find((x) => x.currency === currency && x.billing_interval === "year");
          const current = s?.plan_code === p.code;
          return (
            <div
              key={p.code}
              className={cn(
                "flex flex-col rounded-lg border bg-surface p-5",
                current ? "border-maroon shadow-glow-red" : "border-line",
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {current && <Badge tone="maroon">current</Badge>}
              </div>
              <p className="mt-1 text-sm text-ink-3">{p.tagline}</p>
              <div className="mt-4">
                {p.is_custom ? (
                  <span className="text-lg font-semibold">Custom pricing</span>
                ) : month ? (
                  <>
                    <span className="tnum text-2xl font-semibold">{formatMoney(Number(month.amount), currency)}</span>
                    <span className="text-sm text-ink-3"> / month</span>
                    {year && (
                      <div className="text-xs text-ink-3">
                        or {formatMoney(Number(year.amount), currency)} / year
                        {Number(month.amount) * 12 > Number(year.amount)
                          ? ` (save ${formatMoney(Number(month.amount) * 12 - Number(year.amount), currency)})`
                          : ""}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-ink-3">Not available in {currency}</span>
                )}
              </div>
              <ul className="mt-4 flex-1 space-y-1 text-sm text-ink-2">
                <li>{p.max_athletes === null ? "Unlimited athletes" : `Up to ${p.max_athletes} athletes`}</li>
                <li>{p.max_staff === null ? "Unlimited staff" : `Up to ${p.max_staff} staff accounts`}</li>
                {Object.entries(FEATURES)
                  .filter(([k]) => p.features[k])
                  .slice(0, 8)
                  .map(([k, label]) => (
                    <li key={k} className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {label}
                    </li>
                  ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-2">
                {p.is_custom ? (
                  <a href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`${p.name} — ${org?.name ?? ""}`)}`}>
                    <Button variant="outline">Contact sales</Button>
                  </a>
                ) : paying ? (
                  current ? (
                    <span className="text-sm text-ink-3">Your current plan</span>
                  ) : (
                    <form action="/api/billing/portal" method="post">
                      <Button type="submit" variant="secondary">
                        Switch in billing portal
                      </Button>
                    </form>
                  )
                ) : (
                  stripeReady &&
                  (["month", "year"] as const)
                    .filter((i) => (i === "month" ? month : year))
                    .map((i) => (
                      <form key={i} action="/api/billing/checkout" method="post">
                        <input type="hidden" name="plan" value={p.code} />
                        <input type="hidden" name="interval" value={i} />
                        <Button type="submit" variant={i === "year" ? "primary" : "secondary"}>
                          {i === "month" ? "Pay monthly" : "Pay yearly"}
                        </Button>
                      </form>
                    ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

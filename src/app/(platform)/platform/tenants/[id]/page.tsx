import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getAllPlans, getTenantDetail } from "@/lib/platform/data";
import { captureTenantUsage } from "@/lib/platform/actions";
import { FEATURES, formatMoney, SPORTS } from "@/lib/platform/catalog";
import { resolveEntitlements } from "@/lib/platform/entitlements";
import { ActionButton } from "../../../_components/action-button";
import { KV, SubscriptionBadge, UsageMeter, fmtDate, fmtDateTime } from "../../../_components/ui";
import { ChangePlanControl, DomainControls, SuspendControl } from "./tenant-controls";

export const dynamic = "force-dynamic";

function stripeDashboardUrl(kind: "customers" | "subscriptions", id: string) {
  const test = (process.env.STRIPE_BILLING_SECRET_KEY ?? "").startsWith("sk_test_");
  return `https://dashboard.stripe.com/${test ? "test/" : ""}${kind}/${encodeURIComponent(id)}`;
}

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, plans] = await Promise.all([getTenantDetail(id), getAllPlans()]);
  if (!t) notFound();

  const { org, subscription: sub, plan } = t;
  const ent = resolveEntitlements(org.id, sub, plan, Boolean(org.suspended_at));
  const price = plan ? plans.find((p) => p.code === plan.code)?.prices : undefined;
  const listPrice = sub
    ? price?.find((p) => p.currency === sub.currency && p.billing_interval === sub.billing_interval)?.amount
    : undefined;
  const latest = t.usage[0];

  return (
    <div className="space-y-6">
      <Link href={"/platform/tenants" as never} className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Tenants
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{org.name}</h1>
          <p className="mt-1 text-sm text-ink-2">
            /{org.slug} · {SPORTS.find((s) => s.value === org.sport)?.label ?? org.sport ?? "—"} · {org.country} ·{" "}
            {org.currency} · since {fmtDate(org.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SubscriptionBadge status={sub?.status ?? null} suspended={Boolean(org.suspended_at)} />
          {ent.live ? <Badge tone="success">access live</Badge> : <Badge tone="danger">no access</Badge>}
        </div>
      </div>

      {org.suspended_at && (
        <Card className="border-danger/40 bg-danger-soft p-4 text-sm">
          Suspended {fmtDateTime(org.suspended_at)} — {org.suspended_reason ?? "no reason recorded"}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Subscription */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <span className="text-xs text-ink-3">{sub ? `updated ${fmtDateTime(sub.updated_at)}` : "none"}</span>
          </CardHeader>
          <CardBody className="grid gap-6 md:grid-cols-2">
            <dl>
              <KV label="Plan">{plan?.name ?? sub?.plan_code ?? "—"}</KV>
              <KV label="Billing">{sub ? `${sub.currency} · ${sub.billing_interval}ly` : "—"}</KV>
              <KV label="Price">
                {sub?.custom_amount != null
                  ? `${formatMoney(Number(sub.custom_amount), sub.currency)} (custom)`
                  : listPrice != null && sub
                    ? formatMoney(Number(listPrice), sub.currency)
                    : "—"}
              </KV>
              <KV label="Trial ends">{fmtDate(sub?.trial_ends_at)}</KV>
              <KV label="Period end">{fmtDate(sub?.current_period_end)}</KV>
              <KV label="Cancels at period end">{sub?.cancel_at_period_end ? "yes" : "no"}</KV>
              <KV label="Stripe customer">
                {sub?.stripe_customer_id ? (
                  <a
                    className="inline-flex items-center gap-1 font-mono text-xs text-[#C19A45] hover:underline"
                    href={stripeDashboardUrl("customers", sub.stripe_customer_id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {sub.stripe_customer_id} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  "—"
                )}
              </KV>
              <KV label="Stripe subscription">
                {sub?.stripe_subscription_id ? (
                  <a
                    className="inline-flex items-center gap-1 font-mono text-xs text-[#C19A45] hover:underline"
                    href={stripeDashboardUrl("subscriptions", sub.stripe_subscription_id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {sub.stripe_subscription_id} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  "—"
                )}
              </KV>
            </dl>
            <div className="space-y-4">
              <h4 className="text-xs font-medium uppercase tracking-wide text-ink-3">Change plan (operator override)</h4>
              <ChangePlanControl
                orgId={org.id}
                plans={plans.map((p) => ({ code: p.code, name: p.name, is_active: p.is_active }))}
                current={{
                  plan: sub?.plan_code ?? null,
                  status: sub?.status ?? null,
                  trialEndsAt: sub?.trial_ends_at ?? null,
                  customAmount: sub?.custom_amount ?? null,
                }}
              />
            </div>
          </CardBody>
        </Card>

        {/* Suspension */}
        <Card>
          <CardHeader>
            <CardTitle>{org.suspended_at ? "Reactivate" : "Suspend"}</CardTitle>
          </CardHeader>
          <CardBody>
            <SuspendControl orgId={org.id} suspended={Boolean(org.suspended_at)} />
          </CardBody>
        </Card>

        {/* Usage */}
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <ActionButton action={captureTenantUsage.bind(null, org.id)}>Snapshot</ActionButton>
          </CardHeader>
          <CardBody>
            <dl>
              <KV label="Athletes">
                <UsageMeter used={t.counts.athletes} limit={ent.limits.athletes} />
              </KV>
              <KV label="Staff">
                <UsageMeter used={t.staff.length} limit={ent.limits.staff} />
              </KV>
              <KV label="Families">{t.counts.families}</KV>
              <KV label="Programs">{t.counts.programs}</KV>
              <KV label="Coaches">{t.counts.coaches}</KV>
              <KV label="Invoices (all time)">{t.counts.invoices}</KV>
              <KV label="Registrations (30d)">{latest ? latest.registrations_30d : "—"}</KV>
              <KV label="Invoiced (30d)">{latest ? formatMoney(Number(latest.invoiced_30d), org.currency ?? "CHF") : "—"}</KV>
            </dl>
            {t.usage.length > 1 && (
              <div className="mt-4">
                <div className="mb-1 text-xs text-ink-3">Athletes, last {t.usage.length} snapshots</div>
                <div className="flex h-12 items-end gap-0.5">
                  {[...t.usage].reverse().map((u) => {
                    const max = Math.max(...t.usage.map((x) => x.athletes), 1);
                    return (
                      <div
                        key={u.id}
                        title={`${u.captured_on}: ${u.athletes}`}
                        className="flex-1 rounded-sm bg-[#C19A45]/70"
                        style={{ height: `${Math.max(4, (u.athletes / max) * 100)}%` }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Config support view */}
        <Card>
          <CardHeader>
            <CardTitle>Configuration (read-only)</CardTitle>
          </CardHeader>
          <CardBody>
            {t.config ? (
              <dl>
                <KV label="Currency">{t.config.currency}</KV>
                <KV label="Default locale">{t.config.defaultLocale}</KV>
                <KV label="Payment methods">{t.config.paymentMethods.join(", ") || "—"}</KV>
                <KV label="Invoice pattern">
                  <span className="font-mono text-xs">{t.config.invoicePattern}</span>
                </KV>
                <KV label="Brand colour">
                  {typeof t.config.brand?.primary_color === "string" ? (
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full border border-line"
                        style={{ background: /^#[0-9a-f]{6}$/i.test(t.config.brand.primary_color) ? t.config.brand.primary_color : undefined }}
                      />
                      <span className="font-mono text-xs">{t.config.brand.primary_color}</span>
                    </span>
                  ) : (
                    "default"
                  )}
                </KV>
                <KV label="Contact email">
                  {typeof t.config.profile?.contact_email === "string" ? t.config.profile.contact_email : "—"}
                </KV>
                <KV label="Settings sections">{t.config.settingsKeys.join(", ") || "—"}</KV>
              </dl>
            ) : (
              <p className="text-sm text-ink-3">No app_settings row.</p>
            )}
          </CardBody>
        </Card>

        {/* Features */}
        <Card>
          <CardHeader>
            <CardTitle>Entitlements</CardTitle>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-1.5 text-sm">
            {Object.entries(FEATURES).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-ink-2">{label}</span>
                <span className={ent.features[k] ? "text-success" : "text-ink-4"}>{ent.features[k] ? "on" : "off"}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Staff */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Staff accounts</CardTitle>
            <span className="text-xs text-ink-3">support view — no impersonation</span>
          </CardHeader>
          <CardBody className="space-y-1">
            {t.staff.length === 0 && <p className="text-sm text-ink-3">No staff.</p>}
            {t.staff.map((s) => (
              <div key={s.profileId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2 text-sm last:border-b-0">
                <div>
                  <div className="text-ink">{s.name ?? "—"}</div>
                  <div className="text-xs text-ink-3">{s.email}</div>
                </div>
                <div className="flex gap-1">
                  {s.roles.map((r) => (
                    <Badge key={r} tone={r === "admin" ? "maroon" : "neutral"}>
                      {r}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Domains */}
        <Card>
          <CardHeader>
            <CardTitle>Custom domains</CardTitle>
            {!ent.features.custom_domain && <span className="text-xs text-warning">not in plan</span>}
          </CardHeader>
          <CardBody>
            <DomainControls
              orgId={org.id}
              domains={t.domains.map((d) => ({
                id: d.id,
                domain: d.domain,
                status: d.status,
                token: d.verification_token,
                lastError: d.last_error,
                checkedAt: d.last_checked_at,
              }))}
            />
          </CardBody>
        </Card>

        {/* Billing events */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Billing events</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1 text-sm">
            {t.billingEvents.length === 0 && <p className="text-ink-3">No Stripe events yet.</p>}
            {t.billingEvents.map((e) => (
              <div key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-line-soft py-1.5 last:border-b-0">
                <span className="font-mono text-xs text-ink-2">{e.type}</span>
                <span className="text-xs text-ink-3">
                  {fmtDateTime(e.received_at)} · {e.processed_at ? "processed" : "pending"}
                  {e.error ? ` · ${e.error}` : ""}
                </span>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Audit */}
        <Card>
          <CardHeader>
            <CardTitle>Operator audit log</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1 text-sm">
            {t.audit.length === 0 && <p className="text-ink-3">No operator actions.</p>}
            {t.audit.map((a) => (
              <div key={a.id} className="border-b border-line-soft py-1.5 last:border-b-0">
                <div className="font-mono text-xs text-ink-2">{a.action}</div>
                <div className="text-xs text-ink-3">{fmtDateTime(a.created_at)}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

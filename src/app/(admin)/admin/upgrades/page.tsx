import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader, StatCard } from "@/components/ui";
import { AddonToggle, PlanSwitcher, ShowLockedToggle, TrialButton, WithdrawPlanChange, type PlanChoice } from "@/components/upgrades/upgrade-controls";
import { CATEGORY_ICON } from "@/components/upgrades/upsell-screen";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { TRIAL_DAYS } from "@/lib/platform/catalog";
import { checkLimit } from "@/lib/platform/features";
import { SALES_EMAIL } from "@/lib/platform/signup-data";
import type { PlanPriceRow } from "@/lib/platform/types";
import { FEATURE_CATALOG, FEATURE_CATEGORIES, routeFeatureMap, type FeatureCategory } from "@/lib/upgrades/catalog";
import { stripeBillable } from "@/lib/upgrades/billing";
import { upgradesAdminDb } from "@/lib/upgrades/db";
import { showLockedModules } from "@/lib/upgrades/nav";
import { canPurchase, canStartTrial, estimateProration, planChangeDirection, previewPlanChange, type FeatureState, type PlanLite } from "@/lib/upgrades/resolve";
import { getOrgFeatureContext } from "@/lib/upgrades/server";

export const dynamic = "force-dynamic";

const STATE_TONE: Record<FeatureState, "neutral" | "success" | "warning" | "danger" | "brand" | "accent" | "info" | "premium"> = {
  core: "neutral",
  included: "success",
  addon: "brand",
  addon_canceling: "warning",
  trial: "info",
  complimentary: "accent",
  pending: "warning",
  blocked: "danger",
  requires: "warning",
  available: "premium",
  upgrade: "neutral",
  unavailable: "neutral",
};

/**
 * Plan & upgrades (club admins buy; finance views). Current plan, athletes vs
 * cap, every module grouped by category with its state, a switch per
 * purchasable add-on, free trials, plan changes with a lock preview, and the
 * "show locked modules in the menu" preference.
 */
export default async function UpgradesPage() {
  const me = await requireRole(["admin", "finance"]);
  const { t, f } = await getI18n();
  if (!me.orgId) return <ErrorState message={t("upgrades.errors.generic")} />;
  const isAdmin = me.roles.includes("admin");

  const [ctx, athletes, showLocked, pricesRes] = await Promise.all([
    getOrgFeatureContext(me.orgId),
    checkLimit(me.orgId, "athletes", 0),
    showLockedModules(me.orgId),
    upgradesAdminDb().from("plan_prices").select("*"),
  ]);
  const sub = ctx.subscription;
  const currency = ctx.input.currency;
  const interval = sub?.billing_interval ?? "month";
  const billable = stripeBillable(sub);
  const periodEnd = sub?.current_period_end ?? null;
  const periodEndLabel = periodEnd ? f.date(periodEnd) : "";
  const plan = ctx.plans.find((p) => p.code === sub?.plan_code) ?? null;
  const planName = (code: string | null | undefined) => ctx.plans.find((p) => p.code === code)?.name ?? code ?? "";
  const name = (k: string) => t.dynamic(`upgrades.features.${k}.name`, undefined, k);
  const money = (n: number) => f.money(n, currency, { compactZeros: true });
  const prices = (pricesRes.data ?? []) as PlanPriceRow[];
  const monthlyOf = (code: string) => {
    const row = prices.find((p) => p.plan_code === code && p.currency === currency && p.billing_interval === interval);
    if (!row) return null;
    return interval === "year" ? Number(row.amount) / 12 : Number(row.amount);
  };
  const adminHref = new Map<string, string>();
  for (const [href, keys] of routeFeatureMap("admin")) for (const k of keys) if (!adminHref.has(k)) adminHref.set(k, href);

  const addonsTotal = ctx.grants
    .filter((g) => g.kind === "addon" && (g.status === "active" || g.status === "canceling"))
    .reduce((s, g) => s + Number(g.amount ?? 0), 0);

  const planChoices: PlanChoice[] = ctx.plans
    .filter((p) => p.is_active && (p.is_public || p.code === sub?.plan_code))
    .map((p) => {
      const preview = previewPlanChange(ctx.input, p.code);
      const direction = planChangeDirection(ctx.plans as unknown as PlanLite[], sub?.plan_code ?? null, p.code);
      const m = monthlyOf(p.code);
      return {
        code: p.code,
        name: p.name,
        price: m !== null ? money(Math.round(m * 100) / 100) : null,
        current: p.code === sub?.plan_code,
        custom: p.is_custom,
        direction,
        mode: billable ? "stripe" : sub?.status === "trialing" && !sub?.stripe_subscription_id ? "trial" : "manual",
        lose: preview.lose.map(name),
        gain: preview.gain.map(name),
      } satisfies PlanChoice;
    });

  const byCategory = new Map<FeatureCategory, typeof FEATURE_CATALOG[number][]>();
  for (const feat of FEATURE_CATALOG) byCategory.set(feat.category, [...(byCategory.get(feat.category) ?? []), feat]);

  const statusKey = sub?.status ?? null;
  const near = athletes.limit !== null && athletes.used >= athletes.limit * 0.9;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("upgrades.title")} description={t("upgrades.description")} />

      {!isAdmin && <p className="rounded-md border border-border bg-surface p-3 text-sm text-text-muted">{t("upgrades.page.financeView")}</p>}
      {isAdmin && !billable && <p className="rounded-md border border-border bg-surface p-3 text-sm text-text-muted">{t("upgrades.page.billingManual")}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("upgrades.page.currentPlan")}
          value={plan?.name ?? t("upgrades.page.noPlan")}
          hint={
            statusKey
              ? `${t.dynamic(`upgrades.page.statuses.${statusKey}`, undefined, statusKey)}${
                  sub?.status === "trialing" && sub.trial_ends_at
                    ? ` · ${t("upgrades.page.trialEnds", { date: f.date(sub.trial_ends_at) })}`
                    : periodEnd
                      ? ` · ${t("upgrades.page.renews", { date: periodEndLabel })}`
                      : ""
                }`
              : undefined
          }
        />
        <StatCard
          label={t("upgrades.page.athletes")}
          value={
            athletes.limit === null
              ? t("upgrades.page.unlimited", { used: athletes.used })
              : t("upgrades.page.athletesOf", { used: athletes.used, limit: athletes.limit })
          }
          hint={near ? t("upgrades.page.nearCap") : undefined}
        />
        <StatCard label={t("upgrades.page.addonsTotal")} value={money(Math.round(addonsTotal * 100) / 100)} />
      </div>

      {sub?.pending_plan_code && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-text">
          {sub.pending_plan_effective_at
            ? t("upgrades.page.scheduledPlan", { plan: planName(sub.pending_plan_code), date: f.date(sub.pending_plan_effective_at) })
            : t("upgrades.page.pendingPlan", { plan: planName(sub.pending_plan_code) })}
          {isAdmin && <WithdrawPlanChange />}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("upgrades.page.changePlan")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <PlanSwitcher plans={planChoices} periodEnd={periodEndLabel} canChange={isAdmin && Boolean(sub)} salesHref={`mailto:${SALES_EMAIL}`} />
          <p className="text-xs text-text-muted">{t("upgrades.page.proposal", { currency })}</p>
        </CardBody>
      </Card>

      {FEATURE_CATEGORIES.map((cat) => {
        const feats = byCategory.get(cat) ?? [];
        if (!feats.length) return null;
        const Icon = CATEGORY_ICON[cat];
        return (
          <Card key={cat}>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <Icon className="h-4 w-4 text-brand-accent" aria-hidden />
                  {t.dynamic(`upgrades.categories.${cat}`)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <ul className="divide-y divide-border-soft">
                {feats.map((feat) => {
                  const a = ctx.access[feat.key];
                  const grant = ctx.grants.find(
                    (g) => g.feature_key === feat.key && g.kind === "addon" && ["pending", "active", "canceling"].includes(g.status),
                  );
                  const togglable = isAdmin && a.price !== null && (canPurchase(a) || ["addon", "addon_canceling", "pending"].includes(a.state));
                  const stateLabel = t.dynamic(`upgrades.states.${a.state}`, { date: a.endsAt ? f.date(a.endsAt) : "" }, a.state);
                  const href = adminHref.get(feat.key);
                  return (
                    <li key={feat.key} id={`feature-${feat.key}`} className="flex flex-col gap-3 px-[18px] py-3.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-text">{name(feat.key)}</span>
                          <Badge tone={STATE_TONE[a.state]}>{stateLabel}</Badge>
                          {a.state === "upgrade" && a.upgradePlan && <span className="text-xs text-text-muted">{t("upgrades.gate.inPlan", { plan: planName(a.upgradePlan) })}</span>}
                        </div>
                        <p className="text-xs text-text-muted">{t.dynamic(`upgrades.features.${feat.key}.description`)}</p>
                        {a.missing.length > 0 && (
                          <p className="text-xs text-warning">{t("upgrades.page.requiresList", { features: a.missing.map(name).join(", ") })}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {a.price !== null && !a.enabled && a.state !== "blocked" && (
                          <span className="text-sm text-text-muted">{t("upgrades.page.perMonth", { price: money(a.price) })}</span>
                        )}
                        {(a.state === "addon" || a.state === "addon_canceling") && grant?.amount != null && (
                          <span className="text-sm text-text-muted">{t("upgrades.page.perMonth", { price: money(Number(grant.amount)) })}</span>
                        )}
                        {a.enabled && href && (
                          <Link href={href as never} className="text-sm text-brand-primary underline-offset-4 hover:underline">
                            {t("upgrades.page.open")}
                          </Link>
                        )}
                        {isAdmin && canStartTrial(a) && <TrialButton featureKey={feat.key} label={t("upgrades.page.tryFree")} />}
                        {togglable && a.price !== null && (
                          <AddonToggle
                            featureKey={feat.key}
                            checked={a.state === "addon"}
                            pending={a.state === "pending"}
                            billable={billable}
                            labels={{
                              name: name(feat.key),
                              price: money(a.price),
                              proration: billable ? f.money(estimateProration(a.price, periodEnd), currency) : null,
                              periodEnd: a.endsAt ? f.date(a.endsAt) : periodEndLabel,
                            }}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        );
      })}

      {isAdmin && (
        <Card>
          <CardBody>
            <ShowLockedToggle initial={showLocked} />
          </CardBody>
        </Card>
      )}
      <p className="text-xs text-text-muted">{t("upgrades.gate.dataKept")} {t("upgrades.gate.priceNote")} · {t("upgrades.gate.startTrial", { days: TRIAL_DAYS })}</p>
    </div>
  );
}

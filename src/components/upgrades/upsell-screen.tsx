import Link from "next/link";
import {
  BadgeCheck, Boxes, Building2, CalendarRange, Globe2, Lock, MessagesSquare, Sparkles, TrendingUp, Users, Wallet, type LucideIcon,
  HeartPulse, Home,
} from "lucide-react";
import { Badge, Card, CardBody } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { TRIAL_DAYS } from "@/lib/platform/catalog";
import { getFeature, type FeatureCategory } from "@/lib/upgrades/catalog";
import { stripeBillable } from "@/lib/upgrades/billing";
import { canPurchase, canStartTrial, estimateProration, type FeatureAccess } from "@/lib/upgrades/resolve";
import type { OrgFeatureContext } from "@/lib/upgrades/server";
import { AddButton, TrialButton } from "./upgrade-controls";

export const CATEGORY_ICON: Record<FeatureCategory, LucideIcon> = {
  core: BadgeCheck,
  programs: CalendarRange,
  communication: MessagesSquare,
  finance: Wallet,
  training: TrendingUp,
  people: Users,
  safety: HeartPulse,
  operations: Boxes,
  family: Home,
  website: Globe2,
  ai: Sparkles,
  enterprise: Building2,
};

/** Who is looking: admins may buy, finance sees prices, members (coaches / parents) never see prices. */
export type UpsellAudience = "admin" | "finance" | "member";

/**
 * Upsell screen for a locked module. Admins: what it does, why it matters,
 * the price in the club's currency, "Start 14-day trial" / "Add to plan" or
 * the plan that includes it. Finance: the same without buttons. Coaches and
 * parents: "ask the club admin", never a price.
 */
export async function UpsellScreen({
  features,
  ctx,
  audience,
}: {
  features: string[];
  ctx: OrgFeatureContext;
  audience: UpsellAudience;
}) {
  const { t, f } = await getI18n();
  const locked = features.filter((k) => !ctx.access[k]?.enabled);
  const keys = locked.length ? locked : features;
  const billable = stripeBillable(ctx.subscription);
  const periodEnd = ctx.subscription?.current_period_end ?? null;
  const planName = (code: string | null) => ctx.plans.find((p) => p.code === code)?.name ?? code ?? "";
  const name = (k: string) => t.dynamic(`upgrades.features.${k}.name`, undefined, k);

  if (audience === "member") {
    return (
      <div className="animate-fade-up mx-auto max-w-xl py-10">
        <Card>
          <CardBody className="flex flex-col items-center gap-3 p-8 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-elevated text-text-muted">
              <Lock className="h-5 w-5" aria-hidden />
            </span>
            <h1 className="font-display text-2xl font-medium text-text">{t("upgrades.gate.askAdminTitle")}</h1>
            <p className="text-sm text-text-muted">{keys.map(name).join(" · ")}</p>
            <p className="text-sm text-text-muted">{t("upgrades.gate.askAdmin")}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-6 py-2">
      {keys.map((k) => (
        <FeatureUpsellCard
          key={k}
          featureKey={k}
          access={ctx.access[k]}
          audience={audience}
          billable={billable}
          labels={{
            name: name(k),
            description: t.dynamic(`upgrades.features.${k}.description`),
            pitch: t.dynamic(`upgrades.features.${k}.pitch`),
            price: ctx.access[k]?.price != null ? f.money(ctx.access[k].price, ctx.input.currency, { compactZeros: true }) : null,
            proration:
              billable && ctx.access[k]?.price
                ? f.money(estimateProration(ctx.access[k].price ?? 0, periodEnd), ctx.input.currency)
                : null,
            periodEnd: periodEnd ? f.date(periodEnd) : "",
            plan: planName(ctx.access[k]?.upgradePlan ?? null),
            missing: (ctx.access[k]?.missing ?? []).map(name).join(", "),
          }}
          t={t}
        />
      ))}
      <p className="text-xs text-text-muted">{t("upgrades.gate.dataKept")}</p>
    </div>
  );
}

function FeatureUpsellCard({
  featureKey,
  access,
  audience,
  billable,
  labels,
  t,
}: {
  featureKey: string;
  access: FeatureAccess | undefined;
  audience: "admin" | "finance";
  billable: boolean;
  labels: {
    name: string; description: string; pitch: string; price: string | null; proration: string | null; periodEnd: string; plan: string; missing: string;
  };
  t: Awaited<ReturnType<typeof getI18n>>["t"];
}) {
  const def = getFeature(featureKey);
  const Icon = def ? CATEGORY_ICON[def.category] : Lock;
  const state = access?.state ?? "unavailable";
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_280px]">
        <CardBody className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="premium">{t("upgrades.gate.eyebrow")}</Badge>
            {def && <span className="text-xs text-text-muted">{t.dynamic(`upgrades.categories.${def.category}`)}</span>}
          </div>
          <h1 className="font-display text-2xl font-medium text-text sm:text-3xl">{t("upgrades.gate.lockedTitle", { feature: labels.name })}</h1>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h2 className="text-xs font-medium uppercase tracking-[0.06em] text-text-muted">{t("upgrades.gate.whatItDoes")}</h2>
              <p className="mt-1 text-sm text-text">{labels.description}</p>
            </div>
            <div>
              <h2 className="text-xs font-medium uppercase tracking-[0.06em] text-text-muted">{t("upgrades.gate.whyItMatters")}</h2>
              <p className="mt-1 text-sm text-text">{labels.pitch}</p>
            </div>
          </div>

          {state === "blocked" && <p className="text-sm text-danger">{t("upgrades.gate.blocked")}</p>}
          {state === "pending" && <p className="text-sm text-warning">{t("upgrades.gate.pending")}</p>}
          {state === "requires" && labels.missing && <p className="text-sm text-warning">{t("upgrades.gate.requires", { features: labels.missing })}</p>}
          {state === "unavailable" && <p className="text-sm text-text-muted">{t("upgrades.gate.unavailable")}</p>}
          {labels.price && (state === "available" || state === "upgrade") && (
            <p className="text-sm text-text">
              <span className="font-display text-xl font-medium">{t("upgrades.gate.price", { price: labels.price })}</span>
              <span className="block text-xs text-text-muted">{t("upgrades.gate.priceNote")}</span>
            </p>
          )}
          {access?.upgradePlan && <p className="text-sm text-text-muted">{t("upgrades.gate.inPlan", { plan: labels.plan })}</p>}
          {access?.trialUsed && state !== "blocked" && <p className="text-xs text-text-muted">{t("upgrades.gate.trialUsed")}</p>}

          {audience === "admin" ? (
            <div className="flex flex-wrap items-start gap-3">
              {canStartTrial(access) && <TrialButton featureKey={featureKey} size="md" label={t("upgrades.gate.startTrial", { days: TRIAL_DAYS })} />}
              {canPurchase(access) && labels.price && (
                <AddButton
                  featureKey={featureKey}
                  billable={billable}
                  label={t("upgrades.gate.addToPlan")}
                  labels={{ name: labels.name, price: labels.price, proration: labels.proration, periodEnd: labels.periodEnd }}
                />
              )}
              <Link href={"/admin/upgrades" as never} className="inline-flex h-10 items-center text-sm text-brand-primary underline-offset-4 hover:underline">
                {access?.upgradePlan ? t("upgrades.gate.seePlans") : t("upgrades.gate.manage")}
              </Link>
            </div>
          ) : (
            <p className="text-sm text-text-muted">{t("upgrades.gate.financeOnly")}</p>
          )}
        </CardBody>
        <div
          aria-hidden
          className="relative hidden min-h-[220px] items-center justify-center border-l border-border bg-gradient-to-br from-brand-primary-soft via-surface-elevated to-brand-accent-soft md:flex"
        >
          <span className="inline-flex h-24 w-24 items-center justify-center rounded-2xl border border-border bg-surface shadow-md">
            <Icon className="h-10 w-10 text-brand-accent" />
          </span>
          <Lock className="absolute bottom-4 right-4 h-4 w-4 text-text-muted" />
        </div>
      </div>
    </Card>
  );
}

"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import { TRIAL_DAYS } from "@/lib/platform/catalog";
import type { PlanPriceRow, PlanRow } from "@/lib/platform/types";
import { getFeature, isCoreFeature } from "./catalog";
import { addStripeAddon, changeStripePlan, stripeBillable } from "./billing";
import { upgradesAdminDb, type FeatureGrantRow } from "./db";
import { canPurchase, canStartTrial, planChangeDirection, type PlanLite } from "./resolve";
import { getOrgFeatureContext } from "./server";

/**
 * Club admin actions on the "Plan & upgrades" page. Only club ADMINS buy or
 * cancel (finance views). The org is the session user's own club, never a
 * client value. Writes use the service role after these checks (club roles
 * have no write policy on org_feature_grants); every change is audit-logged
 * by the table trigger with the admin as requester.
 */

export type UpgradeResult = { ok: true; message: string; pending?: boolean } | { ok: false; error: string };

const KEY_RE = /^[a-z][a-z0-9_]{1,47}$/;

async function adminContext() {
  const [me, i18n] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) return { me: null, ...i18n };
  return { me: { ...me, orgId: me.orgId }, ...i18n };
}

function revalidate() {
  revalidatePath("/admin", "layout");
  revalidatePath("/coach", "layout");
  revalidatePath("/parent", "layout");
}

function featureName(t: Translator, key: string): string {
  return t.dynamic(`upgrades.features.${key}.name`, undefined, key);
}

/** Switch a purchasable add-on on (buy / resume) or off (at period end). */
export async function setAddon(key: string, on: boolean): Promise<UpgradeResult> {
  const { me, t, f } = await adminContext();
  if (!me) return { ok: false, error: t("upgrades.errors.adminOnly") };
  if (!KEY_RE.test(key) || !getFeature(key) || isCoreFeature(key)) return { ok: false, error: t("upgrades.errors.unknownFeature") };

  const ctx = await getOrgFeatureContext(me.orgId);
  const a = ctx.access[key];
  const sub = ctx.subscription;
  const db = upgradesAdminDb();
  const open = ctx.grants.find((g) => g.feature_key === key && g.kind === "addon" && ["pending", "active", "canceling"].includes(g.status));

  if (on) {
    if (open?.status === "canceling") {
      const { error } = await db.from("org_feature_grants").update({ status: "active", ends_at: null }).eq("id", open.id).eq("org_id", me.orgId);
      if (error) return fail(t, error.message);
      revalidate();
      return { ok: true, message: t("upgrades.messages.resumed", { feature: featureName(t, key) }) };
    }
    if (open?.status === "pending") return { ok: true, pending: true, message: t("upgrades.messages.alreadyRequested") };
    if (a.enabled) return { ok: true, message: t("upgrades.messages.alreadyActive") };
    if (a.state === "blocked") return { ok: false, error: t("upgrades.errors.blocked") };
    if (!sub || !ctx.input.live) return { ok: false, error: t("upgrades.errors.noSubscription") };
    if (!canPurchase(a) || a.price === null) return { ok: false, error: t("upgrades.errors.notForSale") };
    const missing = (getFeature(key)?.requires ?? []).filter((r) => !ctx.access[r]?.enabled);
    if (missing.length) {
      return { ok: false, error: t("upgrades.errors.requiresFirst", { features: missing.map((m) => featureName(t, m)).join(", ") }) };
    }

    const base = {
      org_id: me.orgId,
      feature_key: key,
      kind: "addon" as const,
      currency: ctx.input.currency,
      amount: a.price,
      requested_by: me.id,
    };
    if (stripeBillable(sub)) {
      try {
        const { itemId } = await addStripeAddon({ orgId: me.orgId, sub, key, monthly: a.price, currency: ctx.input.currency });
        const { error } = await db.from("org_feature_grants").insert({ ...base, status: "active", stripe_subscription_item_id: itemId });
        // 23505: the webhook recorded the item first — same outcome.
        if (error && error.code !== "23505") return fail(t, error.message);
      } catch (e) {
        logError("upgrades.addon.stripe", e, { feature: key });
        return { ok: false, error: t("upgrades.errors.billingFailed") };
      }
      revalidate();
      return { ok: true, message: t("upgrades.messages.added", { feature: featureName(t, key), price: f.money(a.price, ctx.input.currency) }) };
    }
    // No Stripe Billing for this club (yet): record a request for the platform team.
    const { error } = await db.from("org_feature_grants").insert({ ...base, status: "pending", note: "Requested in Plan & upgrades" });
    if (error && error.code !== "23505") return fail(t, error.message);
    revalidate();
    return { ok: true, pending: true, message: t("upgrades.messages.requested") };
  }

  // ---- switch off -----------------------------------------------------------
  if (!open) return { ok: false, error: t("upgrades.errors.notAnAddon") };
  if (open.status === "pending") {
    const { error } = await db
      .from("org_feature_grants")
      .update({ status: "canceled", ends_at: endAfter(open) })
      .eq("id", open.id)
      .eq("org_id", me.orgId);
    if (error) return fail(t, error.message);
    revalidate();
    return { ok: true, message: t("upgrades.messages.requestWithdrawn") };
  }
  if (open.status === "canceling") return { ok: true, message: t("upgrades.messages.alreadyCanceling") };
  const periodEnd = sub?.current_period_end && new Date(sub.current_period_end) > new Date()
    ? sub.current_period_end
    : new Date(Date.now() + 30 * 86_400_000).toISOString();
  const { error } = await db
    .from("org_feature_grants")
    .update({ status: "canceling", ends_at: periodEnd })
    .eq("id", open.id)
    .eq("org_id", me.orgId);
  if (error) return fail(t, error.message);
  revalidate();
  return { ok: true, message: t("upgrades.messages.removalScheduled", { feature: featureName(t, key), date: f.date(periodEnd) }) };
}

function endAfter(g: Pick<FeatureGrantRow, "starts_at">): string {
  return new Date(Math.max(Date.now(), new Date(g.starts_at).getTime() + 1000)).toISOString();
}

function fail(t: Translator, detail: string): UpgradeResult {
  logError("upgrades.action", new Error(detail));
  return { ok: false, error: t("upgrades.errors.generic") };
}

/** One free 14-day trial per feature (needs a live subscription). */
export async function startFeatureTrial(key: string): Promise<UpgradeResult> {
  const { me, t, f } = await adminContext();
  if (!me) return { ok: false, error: t("upgrades.errors.adminOnly") };
  if (!KEY_RE.test(key) || !getFeature(key) || isCoreFeature(key)) return { ok: false, error: t("upgrades.errors.unknownFeature") };
  const ctx = await getOrgFeatureContext(me.orgId);
  const a = ctx.access[key];
  if (a.enabled) return { ok: true, message: t("upgrades.messages.alreadyActive") };
  if (a.state === "blocked") return { ok: false, error: t("upgrades.errors.blocked") };
  if (!ctx.input.live) return { ok: false, error: t("upgrades.errors.noSubscription") };
  if (!canStartTrial(a)) return { ok: false, error: t("upgrades.errors.trialUsed") };
  const ends = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
  const db = upgradesAdminDb();
  const rows = [key, ...(getFeature(key)?.requires ?? []).filter((r) => !ctx.access[r]?.enabled && canStartTrial(ctx.access[r]))];
  for (const k of rows) {
    const { error } = await db.from("org_feature_grants").insert({
      org_id: me.orgId, feature_key: k, kind: "trial", status: "active", ends_at: ends, requested_by: me.id, note: "Self-serve trial",
    });
    if (error) return error.code === "23505" ? { ok: false, error: t("upgrades.errors.trialUsed") } : fail(t, error.message);
  }
  revalidate();
  return { ok: true, message: t("upgrades.messages.trialStarted", { feature: featureName(t, key), date: f.date(ends) }) };
}

/**
 * Change plan. Upgrade: immediate, prorated. Downgrade: at period end (the
 * features that would lock were shown first). Without Stripe Billing the
 * request goes to the platform team; during a card-less trial the plan
 * switches at once (no money involved). Custom plans: contact sales.
 */
export async function changePlan(planCode: string): Promise<UpgradeResult> {
  const { me, t, f } = await adminContext();
  if (!me) return { ok: false, error: t("upgrades.errors.adminOnly") };
  if (!KEY_RE.test(planCode)) return { ok: false, error: t("upgrades.errors.unknownPlan") };
  const ctx = await getOrgFeatureContext(me.orgId);
  const sub = ctx.subscription;
  if (!sub) return { ok: false, error: t("upgrades.errors.noSubscription") };
  const plan = ctx.plans.find((p) => p.code === planCode) as PlanRow | undefined;
  if (!plan || !plan.is_active || !plan.is_public) return { ok: false, error: t("upgrades.errors.unknownPlan") };
  if (plan.is_custom) return { ok: false, error: t("upgrades.errors.contactSales") };
  const direction = planChangeDirection(ctx.plans as unknown as PlanLite[], sub.plan_code, planCode);
  if (direction === "same") return { ok: true, message: t("upgrades.messages.samePlan") };

  const db = upgradesAdminDb();
  const now = new Date().toISOString();

  if (stripeBillable(sub)) {
    const { data: priceRow } = await db
      .from("plan_prices")
      .select("*")
      .eq("plan_code", planCode)
      .eq("currency", sub.currency)
      .eq("billing_interval", sub.billing_interval)
      .maybeSingle();
    const price = priceRow as PlanPriceRow | null;
    if (!price) return { ok: false, error: t("upgrades.errors.noPrice") };
    if (direction === "upgrade") {
      try {
        await changeStripePlan({ sub, planCode, planName: plan.name, amount: Number(price.amount), stripePriceId: price.stripe_price_id, prorate: true });
      } catch (e) {
        logError("upgrades.plan.stripe", e, { plan: planCode });
        return { ok: false, error: t("upgrades.errors.billingFailed") };
      }
      const { error } = await db
        .from("subscriptions")
        .update({ plan_code: planCode, pending_plan_code: null, pending_plan_effective_at: null, pending_plan_requested_at: null, pending_plan_requested_by: null })
        .eq("org_id", me.orgId);
      if (error) return fail(t, error.message);
      await auditPlan(me.orgId, me.id, "plan.upgraded", sub.plan_code, planCode);
      revalidate();
      return { ok: true, message: t("upgrades.messages.planUpgraded", { plan: plan.name }) };
    }
    const at = sub.current_period_end && new Date(sub.current_period_end) > new Date() ? sub.current_period_end : now;
    const { error } = await db
      .from("subscriptions")
      .update({ pending_plan_code: planCode, pending_plan_effective_at: at, pending_plan_requested_at: now, pending_plan_requested_by: me.id })
      .eq("org_id", me.orgId);
    if (error) return fail(t, error.message);
    await auditPlan(me.orgId, me.id, "plan.downgrade_scheduled", sub.plan_code, planCode);
    revalidate();
    return { ok: true, message: t("upgrades.messages.planDowngradeScheduled", { plan: plan.name, date: f.date(at) }) };
  }

  if (sub.status === "trialing" && !sub.stripe_subscription_id) {
    const { error } = await db
      .from("subscriptions")
      .update({ plan_code: planCode, pending_plan_code: null, pending_plan_effective_at: null, pending_plan_requested_at: null, pending_plan_requested_by: null })
      .eq("org_id", me.orgId);
    if (error) return fail(t, error.message);
    await auditPlan(me.orgId, me.id, "plan.changed_in_trial", sub.plan_code, planCode);
    revalidate();
    return { ok: true, message: t("upgrades.messages.planSwitchedTrial", { plan: plan.name }) };
  }

  const { error } = await db
    .from("subscriptions")
    .update({ pending_plan_code: planCode, pending_plan_effective_at: null, pending_plan_requested_at: now, pending_plan_requested_by: me.id })
    .eq("org_id", me.orgId);
  if (error) return fail(t, error.message);
  await auditPlan(me.orgId, me.id, "plan.change_requested", sub.plan_code, planCode);
  revalidate();
  return { ok: true, pending: true, message: t("upgrades.messages.planRequested") };
}

/** Withdraw a requested or scheduled plan change. */
export async function cancelPlanChange(): Promise<UpgradeResult> {
  const { me, t } = await adminContext();
  if (!me) return { ok: false, error: t("upgrades.errors.adminOnly") };
  const { error } = await upgradesAdminDb()
    .from("subscriptions")
    .update({ pending_plan_code: null, pending_plan_effective_at: null, pending_plan_requested_at: null, pending_plan_requested_by: null })
    .eq("org_id", me.orgId);
  if (error) return fail(t, error.message);
  await auditPlan(me.orgId, me.id, "plan.change_withdrawn", null, null);
  revalidate();
  return { ok: true, message: t("upgrades.messages.planChangeWithdrawn") };
}

/** Club preference: show locked modules in the menu with an "Upgrade" badge (default) or hide them. */
export async function setShowLockedModules(show: boolean): Promise<UpgradeResult> {
  const { me, t } = await adminContext();
  if (!me) return { ok: false, error: t("upgrades.errors.adminOnly") };
  const db = createAdminClient();
  const { data } = await db.from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  const current = (data?.settings ?? {}) as Record<string, Json>;
  const { error } = await db
    .from("app_settings")
    .update({ settings: { ...current, upgrades_show_locked: Boolean(show) }, updated_at: new Date().toISOString() })
    .eq("org_id", me.orgId);
  if (error) return fail(t, error.message);
  revalidate();
  return { ok: true, message: t("upgrades.messages.saved") };
}

async function auditPlan(orgId: string, actor: string, action: string, from: string | null, to: string | null) {
  await Promise.all([
    upgradesAdminDb().from("platform_audit_log").insert({ actor_id: actor, action, org_id: orgId, details: { from, to } }),
    createAdminClient().from("audit_logs").insert({
      org_id: orgId, actor_id: actor, action, target_table: "subscriptions", new_data: { from, to },
    }),
  ]);
}

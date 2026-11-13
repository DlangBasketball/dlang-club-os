"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPlatformAdmin } from "./auth";
import { friendlyError, planSchema } from "./validation";
import { asPlatform, type PlatformClient } from "./types";

/**
 * Platform console server actions. Each one:
 *   1. re-checks the caller is a platform admin (server-side), then
 *   2. calls a SECURITY DEFINER platform_* RPC under the caller's own session,
 *      which checks is_platform_admin() AGAIN in the database.
 * No service-role key is used for operator writes.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const CONSOLE_ERRORS: Record<string, string> = {
  FORBIDDEN: "You are not allowed to do that.",
  NOT_FOUND: "Tenant not found.",
  REASON_REQUIRED: "Please give a reason (at least 3 characters).",
  INVALID_PLAN: "Unknown or inactive plan.",
  INVALID_STATUS: "Invalid subscription status.",
  INVALID_AMOUNT: "Invalid amount.",
  INVALID_CODE: "Invalid plan code.",
  INVALID_NAME: "Invalid plan name.",
  INVALID_FEATURES: "Invalid features.",
  INVALID_PRICES: "Invalid prices.",
};

async function operatorDb(): Promise<PlatformClient | null> {
  const admin = await getPlatformAdmin();
  if (!admin) return null;
  return asPlatform(await createClient());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setTenantSuspended(orgId: string, suspended: boolean, reason: string): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: CONSOLE_ERRORS.FORBIDDEN };
  if (!UUID_RE.test(orgId)) return { ok: false, error: CONSOLE_ERRORS.NOT_FOUND };
  const { error } = await db.rpc("platform_set_org_suspended", {
    p_org: orgId,
    p_suspended: suspended,
    p_reason: suspended ? reason.trim().slice(0, 500) : null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, CONSOLE_ERRORS) };
  revalidatePath("/platform");
  revalidatePath(`/platform/tenants/${orgId}`);
  return { ok: true, message: suspended ? "Tenant suspended" : "Tenant reactivated" };
}

export async function changeTenantPlan(input: {
  orgId: string;
  plan: string;
  status: string;
  trialEndsAt: string;
  customAmount: string;
  /** "" = keep, "yes" = waive onboarding fee (founding club), "no" = charge it. */
  waiveOnboarding?: "" | "yes" | "no";
}): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: CONSOLE_ERRORS.FORBIDDEN };
  if (!UUID_RE.test(input.orgId)) return { ok: false, error: CONSOLE_ERRORS.NOT_FOUND };

  let trial: string | null = null;
  if (input.trialEndsAt) {
    const d = new Date(`${input.trialEndsAt}T23:59:59Z`);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Invalid trial end date" };
    trial = d.toISOString();
  }
  let amount: number | null = null;
  if (input.customAmount.trim() !== "") {
    amount = Number(input.customAmount);
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: CONSOLE_ERRORS.INVALID_AMOUNT };
  }

  const { error } = await db.rpc("platform_change_plan", {
    p_org: input.orgId,
    p_plan: input.plan,
    p_status: input.status || null,
    p_trial_ends_at: trial,
    p_custom_amount: amount,
    p_waive_onboarding: input.waiveOnboarding === "yes" ? true : input.waiveOnboarding === "no" ? false : null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, CONSOLE_ERRORS) };
  revalidatePath("/platform");
  revalidatePath(`/platform/tenants/${input.orgId}`);
  return {
    ok: true,
    message:
      "Plan updated. If this tenant pays through Stripe, also change the subscription in Stripe (or let the customer switch in the portal) — the next Stripe event will otherwise overwrite this.",
  };
}

export async function captureTenantUsage(orgId: string): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: CONSOLE_ERRORS.FORBIDDEN };
  if (!UUID_RE.test(orgId)) return { ok: false, error: CONSOLE_ERRORS.NOT_FOUND };
  const { error } = await db.rpc("capture_usage_snapshot", { p_org: orgId });
  if (error) return { ok: false, error: friendlyError(error.message, CONSOLE_ERRORS) };
  revalidatePath(`/platform/tenants/${orgId}`);
  return { ok: true, message: "Usage snapshot captured" };
}

export async function captureAllUsage(): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: CONSOLE_ERRORS.FORBIDDEN };
  const { data, error } = await db.rpc("capture_all_usage_snapshots");
  if (error) return { ok: false, error: friendlyError(error.message, CONSOLE_ERRORS) };
  revalidatePath("/platform");
  return { ok: true, message: `Captured usage for ${data ?? 0} tenants` };
}

export async function addTenantDomain(orgId: string, domain: string): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: CONSOLE_ERRORS.FORBIDDEN };
  if (!UUID_RE.test(orgId)) return { ok: false, error: CONSOLE_ERRORS.NOT_FOUND };
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) {
    return { ok: false, error: "Enter a bare domain like club.example.com" };
  }
  const { error } = await db.from("tenant_domains").insert({ org_id: orgId, domain: d });
  if (error) {
    return { ok: false, error: error.code === "23505" ? "That domain is already registered" : "Could not add domain" };
  }
  revalidatePath(`/platform/tenants/${orgId}`);
  return { ok: true, message: "Domain added — ask the club to create the TXT record, then verify." };
}

export async function removeTenantDomain(orgId: string, domainId: string): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: CONSOLE_ERRORS.FORBIDDEN };
  if (!UUID_RE.test(domainId)) return { ok: false, error: "Not found" };
  const { error } = await db.from("tenant_domains").delete().eq("id", domainId).eq("org_id", orgId);
  if (error) return { ok: false, error: "Could not remove domain" };
  revalidatePath(`/platform/tenants/${orgId}`);
  return { ok: true, message: "Domain removed" };
}

export async function savePlan(raw: unknown): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: CONSOLE_ERRORS.FORBIDDEN };
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: `${i.path.join(".") || "plan"}: ${i.message}` };
  }
  const { prices, ...plan } = parsed.data;
  const { error } = await db.rpc("platform_upsert_plan", {
    p_plan: plan,
    p_prices: prices.map((p) => ({
      currency: p.currency,
      billing_interval: p.billing_interval,
      amount: p.amount === null ? "" : String(p.amount),
      onboarding_fee: p.onboarding_fee === null ? "" : String(p.onboarding_fee),
      stripe_price_id: p.stripe_price_id ?? "",
    })),
  });
  if (error) return { ok: false, error: friendlyError(error.message, CONSOLE_ERRORS) };
  revalidatePath("/platform/plans");
  revalidatePath("/platform");
  return { ok: true, message: `Plan “${plan.name}” saved` };
}

"use server";

import { revalidatePath } from "next/cache";
import { getPlatformAdmin } from "@/lib/platform/auth";
import type { ActionResult } from "@/lib/platform/actions";
import { friendlyError } from "@/lib/platform/validation";
import { getFeature, isCoreFeature } from "./catalog";
import { upgradesUserDb, type UpgradesClient } from "./db";

/**
 * Platform console actions for entitlements, the plan <-> feature matrix and
 * add-on prices. Each one re-checks the caller is a platform admin here, then
 * calls a SECURITY DEFINER platform_* RPC under the caller's OWN session,
 * which checks is_platform_admin() again in the database and audit-logs the
 * change. No service-role key is used for operator writes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERRORS: Record<string, string> = {
  FORBIDDEN: "You are not allowed to do that.",
  NOT_FOUND: "Not found.",
  INVALID_KIND: "Invalid grant type.",
  INVALID_END: "A trial needs an end date in the future.",
  INVALID_STATUS: "Invalid status.",
  UNKNOWN_FEATURE: "Unknown or core feature.",
  CORE_FEATURE: "Core features are always on.",
  ADDON_ONLY: "This module is sold only as an add-on; it cannot be part of a plan.",
  INVALID_PLAN: "Unknown plan.",
  INVALID_CURRENCY: "Invalid currency.",
  INVALID_AMOUNT: "Invalid amount.",
};

async function operatorDb(): Promise<UpgradesClient | null> {
  return (await getPlatformAdmin()) ? upgradesUserDb() : null;
}

const KINDS = ["complimentary", "founding", "trial", "block", "complimentary_all"] as const;
export type PlatformGrantKind = (typeof KINDS)[number];

/** Grant (complimentary / founding / everything), start a trial of N days, or block a feature for a tenant. */
export async function setTenantGrant(input: {
  orgId: string;
  feature: string;
  kind: PlatformGrantKind;
  days?: number | null;
  note?: string;
}): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: ERRORS.FORBIDDEN };
  if (!UUID_RE.test(input.orgId)) return { ok: false, error: ERRORS.NOT_FOUND };
  if (!KINDS.includes(input.kind)) return { ok: false, error: ERRORS.INVALID_KIND };
  const all = input.kind === "complimentary_all";
  if (!all && (!getFeature(input.feature) || isCoreFeature(input.feature))) return { ok: false, error: ERRORS.UNKNOWN_FEATURE };
  let ends: string | null = null;
  if (input.kind === "trial") {
    const days = Math.round(Number(input.days ?? 14));
    if (!Number.isFinite(days) || days < 1 || days > 365) return { ok: false, error: "Trial length must be 1–365 days." };
    ends = new Date(Date.now() + days * 86_400_000).toISOString();
  }
  const { error } = await db.rpc("platform_set_feature_grant", {
    p_org: input.orgId,
    p_key: all ? "*" : input.feature,
    p_kind: input.kind,
    p_ends_at: ends,
    p_note: (input.note ?? "").trim().slice(0, 500) || null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, ERRORS) };
  revalidatePath(`/platform/tenants/${input.orgId}`);
  return { ok: true, message: input.kind === "block" ? "Blocked" : input.kind === "trial" ? "Trial started" : "Granted" };
}

/** Activate a pending add-on request, or end any grant now. */
export async function updateTenantGrant(orgId: string, grantId: string, status: "active" | "canceled"): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: ERRORS.FORBIDDEN };
  if (!UUID_RE.test(orgId) || !UUID_RE.test(grantId)) return { ok: false, error: ERRORS.NOT_FOUND };
  const { error } = await db.rpc("platform_update_feature_grant", { p_grant: grantId, p_status: status });
  if (error) return { ok: false, error: friendlyError(error.message, ERRORS) };
  revalidatePath(`/platform/tenants/${orgId}`);
  revalidatePath("/platform");
  return { ok: true, message: status === "active" ? "Activated — remember to bill it in Stripe if needed" : "Ended" };
}

/** Plan matrix cell. */
export async function setPlanFeature(plan: string, feature: string, included: boolean): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: ERRORS.FORBIDDEN };
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(plan)) return { ok: false, error: ERRORS.INVALID_PLAN };
  const { error } = await db.rpc("platform_set_plan_feature", { p_plan: plan, p_key: feature, p_included: included });
  if (error) return { ok: false, error: friendlyError(error.message, ERRORS) };
  revalidatePath("/platform/plans/features");
  revalidatePath("/platform/plans");
  return { ok: true, message: included ? "Included" : "Removed" };
}

/** Add-on price per currency; empty = not sold in that currency. */
export async function setAddonPrice(feature: string, currency: string, amount: string): Promise<ActionResult> {
  const db = await operatorDb();
  if (!db) return { ok: false, error: ERRORS.FORBIDDEN };
  if (!["CHF", "EUR", "USD"].includes(currency)) return { ok: false, error: ERRORS.INVALID_CURRENCY };
  const trimmed = amount.trim();
  const value = trimmed === "" ? null : Number(trimmed);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100000)) return { ok: false, error: ERRORS.INVALID_AMOUNT };
  const { error } = await db.rpc("platform_set_addon_price", { p_key: feature, p_currency: currency, p_amount: value });
  if (error) return { ok: false, error: friendlyError(error.message, ERRORS) };
  revalidatePath("/platform/plans/features");
  return { ok: true, message: value === null ? "Not sold" : "Saved" };
}

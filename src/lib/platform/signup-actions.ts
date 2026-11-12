"use server";

import { createClient } from "@/lib/supabase/server";
import { friendlyError, slugProblem, tenantSignupSchema } from "./validation";
import { asPlatform } from "./types";

export type SlugCheck = { available: boolean; message?: string };

/** Live availability check for the signup form (format + reserved + taken). */
export async function checkSlugAvailability(slug: string): Promise<SlugCheck> {
  const s = slug.trim().toLowerCase();
  const problem = slugProblem(s);
  if (problem) return { available: false, message: problem };
  const db = asPlatform(await createClient());
  const { data, error } = await db.rpc("is_slug_available", { p_slug: s });
  if (error) return { available: false, message: "Could not check availability right now." };
  return data ? { available: true } : { available: false, message: "That address is already taken." };
}

export type ProvisionResult =
  | { ok: true; orgId: string; slug: string; trialEndsAt: string | null }
  | { ok: false; error: string; field?: string };

/**
 * Creates the tenant for the signed-in user via provision_tenant() — a
 * SECURITY DEFINER RPC that re-validates everything and makes the caller the
 * org's first admin with a 14-day trial. Runs under the user's own session.
 */
export async function provisionTenantAction(raw: unknown): Promise<ProvisionResult> {
  const parsed = tenantSignupSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0] ?? "") };
  }
  const input = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please confirm your email first — your session has expired." };

  const { data, error } = await asPlatform(supabase).rpc("provision_tenant", {
    p_name: input.name,
    p_slug: input.slug,
    p_sport: input.sport,
    p_country: input.country,
    p_currency: input.currency,
    p_locale: input.locale,
    p_full_name: input.fullName || null,
    p_plan: input.plan,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };

  // Clear the pending signup payload stashed in auth metadata (best effort).
  await supabase.auth.updateUser({ data: { pending_tenant: null } }).catch(() => undefined);

  const out = (data ?? {}) as { org_id?: string; slug?: string; trial_ends_at?: string | null };
  return { ok: true, orgId: out.org_id ?? "", slug: out.slug ?? input.slug, trialEndsAt: out.trial_ends_at ?? null };
}

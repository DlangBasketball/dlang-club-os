import "server-only";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { asPlatform } from "./types";

export type PlatformAdmin = { id: string; email: string | null };

/**
 * Returns the signed-in user if they are a platform (SaaS operator) admin,
 * else null. Checked against public.platform_admins via the SECURITY DEFINER
 * is_platform_admin() RPC under the user's own session — never trusts the
 * client. RLS on every platform table re-checks the same predicate.
 */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await asPlatform(supabase).rpc("is_platform_admin");
  if (error || data !== true) return null;
  return { id: user.id, email: user.email ?? null };
}

/**
 * Server-side guard for /platform pages, routes and actions.
 * Signed-out -> /login; signed-in non-operators get a 404 (the console's
 * existence is not revealed).
 */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/platform");
  const admin = await getPlatformAdmin();
  if (!admin) notFound();
  return admin;
}

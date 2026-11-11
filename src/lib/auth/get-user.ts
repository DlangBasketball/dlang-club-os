import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type AppRole, homeForRoles, hasAnyRole } from "./roles";

export type SessionUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  orgId: string | null;
  roles: AppRole[];
  onboardingCompleted: boolean;
};

/**
 * Resolves the current user with their org, roles, and onboarding status.
 * Roles come from `staff_roles`; `parent` is derived from `family_members`.
 * Returns null if not authenticated.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: roleRows }, { count: familyCount }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, org_id, email, onboarding_completed_at")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.from("staff_roles").select("role").eq("profile_id", user.id),
      supabase
        .from("family_members")
        .select("profile_id", { count: "exact", head: true })
        .eq("profile_id", user.id),
    ]);

  const roles = new Set<AppRole>((roleRows ?? []).map((r) => r.role as AppRole));
  if ((familyCount ?? 0) > 0) roles.add("parent");

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? null,
    fullName: profile?.full_name ?? null,
    orgId: profile?.org_id ?? null,
    roles: Array.from(roles),
    onboardingCompleted: Boolean(profile?.onboarding_completed_at),
  };
}

/** Where to send a user immediately after authenticating. */
export function postLoginDestination(user: SessionUser): string {
  // Parents who haven't finished onboarding go there first.
  if (
    user.roles.includes("parent") &&
    !user.roles.includes("admin") &&
    !user.onboardingCompleted
  ) {
    return "/onboarding";
  }
  return homeForRoles(user.roles);
}

/** Require any authenticated user. */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Server-side route guard. Redirects to /login if signed out, or to the
 * user's own home if they lack one of the allowed roles.
 * NOTE: UX routing only — database RLS is the real boundary.
 */
export async function requireRole(allowed: AppRole[]): Promise<SessionUser> {
  const user = await requireAuth();
  if (!hasAnyRole(user.roles, allowed)) redirect(homeForRoles(user.roles));
  return user;
}

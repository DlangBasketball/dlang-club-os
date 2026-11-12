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
 * Roles come from `staff_roles` in the profile's org; `parent` is derived
 * from `family_members` of families in that org.
 * Returns null if not authenticated.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, org_id, email, onboarding_completed_at")
    .eq("id", user.id)
    .maybeSingle();
  const orgId = profile?.org_id ?? null;

  // Roles count only in the user's own club (profiles.org_id), matching the
  // org-scoped has_role() in the database. A staff_roles row or guardian link
  // in another org must never grant powers here: server actions act on orgId.
  const roles = new Set<AppRole>();
  if (orgId) {
    const [{ data: roleRows }, { data: memberRows }] = await Promise.all([
      supabase
        .from("staff_roles")
        .select("role")
        .eq("profile_id", user.id)
        .eq("org_id", orgId),
      supabase.from("family_members").select("family_id").eq("profile_id", user.id),
    ]);
    for (const r of roleRows ?? []) roles.add(r.role as AppRole);

    const familyIds = (memberRows ?? []).map((m) => m.family_id as string);
    if (familyIds.length > 0) {
      const { count: familyCount } = await supabase
        .from("families")
        .select("id", { count: "exact", head: true })
        .in("id", familyIds)
        .eq("org_id", orgId);
      if ((familyCount ?? 0) > 0) roles.add("parent");
    }
  }

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? null,
    fullName: profile?.full_name ?? null,
    orgId,
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

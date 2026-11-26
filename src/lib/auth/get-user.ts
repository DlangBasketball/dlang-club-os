import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type AppRole, homeForRoles, hasAnyRole } from "./roles";
import { type AppMode, MODE_HOME, effectiveRoles, isAppMode, modeOfPath, modesForRoles } from "./modes";
import { isSafeNextPath } from "./safe-next";

export type SessionUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  orgId: string | null;
  /** Roles that count in the active mode (all roles when the person has one mode). Every guard reads these. */
  roles: AppRole[];
  /** Every role the person holds in the club, whatever the mode (switcher, onboarding rules). */
  allRoles: AppRole[];
  /** Modes the person may switch between (the switcher shows when there are 2+). */
  modes: AppMode[];
  /** Active mode (null when the person has a single mode). */
  mode: AppMode | null;
  onboardingCompleted: boolean;
};

/**
 * Resolves the current user with their org, roles, and onboarding status.
 * Roles come from `staff_roles` in the profile's org; `parent` is derived
 * from `family_members` of families in that org; `player` from an athlete
 * of that org linked to this login (public.is_player(), security definer).
 * Returns null if not authenticated.
 */
export const getSessionUser = cache(loadSessionUser);

async function loadSessionUser(): Promise<SessionUser | null> {
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

    // Player account: players cannot read the athletes table (guardian
    // contacts, medical), so the database answers.
    const { data: isPlayer } = await supabase.rpc("is_player");
    if (isPlayer === true) roles.add("player");
  }

  // Active mode (role switcher, 20250420107000): stored in the database, which
  // enforces it in has_role(); a revoked mode is replaced by one still held.
  const allRoles = Array.from(roles);
  const modes = modesForRoles(allRoles);
  let mode: AppMode | null = null;
  if (modes.length > 1) {
    const { data: state } = await (supabase as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown }> })
      .rpc("active_mode_state", { p_default: modes[0] });
    const m = (state as { mode?: unknown } | null)?.mode;
    mode = isAppMode(m) && modes.includes(m) ? m : modes[0];
  }

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? null,
    fullName: profile?.full_name ?? null,
    orgId,
    roles: effectiveRoles(allRoles, mode),
    allRoles,
    modes,
    mode,
    onboardingCompleted: Boolean(profile?.onboarding_completed_at),
  };
}

/** Where to send a user immediately after authenticating. */
export function postLoginDestination(user: SessionUser): string {
  // Parents who haven't finished onboarding go there first.
  if (
    user.allRoles.includes("parent") &&
    !user.allRoles.includes("admin") &&
    !user.onboardingCompleted
  ) {
    return "/onboarding";
  }
  return user.mode ? MODE_HOME[user.mode] : homeForRoles(user.roles);
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

/** Home of the user's active mode (or of their roles when they have one mode). */
export function homeFor(user: SessionUser): string {
  return user.mode ? MODE_HOME[user.mode] : homeForRoles(user.roles);
}

/**
 * Guard of a mode's route area (admin, coach, parent layouts). A person with
 * several modes must be IN that mode: a direct link to another mode's page
 * asks to switch first (/switch-mode), a page of a mode they do not hold sends
 * them to their own home. One mode: the role check as before.
 */
export async function requireArea(area: AppMode, allowed: AppRole[]): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.modes.length > 1) {
    if (user.mode !== area) {
      if (user.modes.includes(area)) {
        const path = (await headers()).get("x-request-path") ?? "";
        const next = path && isSafeNextPath(path) && modeOfPath(path) === area ? `&next=${encodeURIComponent(path)}` : "";
        redirect(`/switch-mode?to=${area}${next}`);
      }
      redirect(homeFor(user));
    }
  }
  if (!hasAnyRole(user.roles, allowed)) redirect(homeFor(user));
  return user;
}

import type { AppRole } from "./roles";

/**
 * Role switcher (migration 20250420107000): one login, several roles, one
 * active mode. Pure helpers shared by the server (session, guards, actions)
 * and the header switcher. The database decides the available modes and the
 * stored mode (available_modes / active_mode_state); these mirror the rules.
 */
export type AppMode = "admin" | "coach" | "parent";
export const APP_MODES: readonly AppMode[] = ["admin", "coach", "parent"];

/** Where each mode opens (its dashboard). */
export const MODE_HOME: Record<AppMode, string> = {
  admin: "/admin/dashboard",
  coach: "/coach",
  parent: "/parent/home",
};

/** The route area of each mode (first path segment). */
const MODE_PREFIX: Record<AppMode, string> = { admin: "/admin", coach: "/coach", parent: "/parent" };

export function isAppMode(v: unknown): v is AppMode {
  return typeof v === "string" && (APP_MODES as readonly string[]).includes(v);
}

/** Modes a set of real roles gives (admin or finance -> admin, coach -> coach, guardian -> parent). */
export function modesForRoles(roles: AppRole[]): AppMode[] {
  const out: AppMode[] = [];
  if (roles.includes("admin") || roles.includes("finance")) out.push("admin");
  if (roles.includes("coach")) out.push("coach");
  if (roles.includes("parent")) out.push("parent");
  return out;
}

/**
 * Roles that count in a mode (same rule as public.mode_allows_role):
 * admin mode keeps the staff roles (admin / finance / coach), coach mode only
 * coach, parent mode only parent. A player login is not a mode and is kept.
 * No mode (one role only) = all roles, unchanged.
 */
export function effectiveRoles(roles: AppRole[], mode: AppMode | null): AppRole[] {
  if (!mode) return roles;
  const keep: Record<AppMode, AppRole[]> = {
    admin: ["admin", "finance", "coach", "player"],
    coach: ["coach", "player"],
    parent: ["parent", "player"],
  };
  return roles.filter((r) => keep[mode].includes(r));
}

/** The mode whose area a path belongs to (null = shared pages such as /onboarding, /player, /legal). */
export function modeOfPath(path: string): AppMode | null {
  const p = path.split("?")[0] ?? "";
  for (const m of APP_MODES) if (p === MODE_PREFIX[m] || p.startsWith(`${MODE_PREFIX[m]}/`)) return m;
  return null;
}

/** Label key of a mode for a person (finance-only staff see "Finance" instead of "Admin"). */
export function modeLabelKey(mode: AppMode, roles: AppRole[]): "admin" | "finance" | "coach" | "parent" {
  if (mode === "admin" && !roles.includes("admin") && roles.includes("finance")) return "finance";
  return mode;
}

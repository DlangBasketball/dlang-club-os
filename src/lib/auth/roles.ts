/**
 * `player`: an athlete's own login (team attendance migration
 * 20250420104000). Derived from athletes.player_profile_id like `parent` is
 * derived from family_members; never a staff role. Lands in the player
 * portal (/player, route group (player)).
 */
export type AppRole = "admin" | "finance" | "coach" | "parent" | "player";

/** Where each role lands after login. */
export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin/dashboard",
  finance: "/admin/dashboard",
  coach: "/coach/schedule",
  parent: "/parent/home",
  player: "/player",
};

/** Highest-privilege role wins when a user holds several. */
export function primaryRole(roles: AppRole[]): AppRole | null {
  const order: AppRole[] = ["admin", "finance", "coach", "parent", "player"];
  return order.find((r) => roles.includes(r)) ?? null;
}

export function homeForRoles(roles: AppRole[]): string {
  const r = primaryRole(roles);
  return r ? ROLE_HOME[r] : "/login";
}

export function hasAnyRole(roles: AppRole[], allowed: AppRole[]) {
  return roles.some((r) => allowed.includes(r));
}

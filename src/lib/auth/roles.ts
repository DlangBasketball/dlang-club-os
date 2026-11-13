export type AppRole = "admin" | "finance" | "coach" | "parent";

/** Where each role lands after login. */
export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin/dashboard",
  finance: "/admin/dashboard",
  coach: "/coach/schedule",
  parent: "/parent/home",
};

/** Highest-privilege role wins when a user holds several. */
export function primaryRole(roles: AppRole[]): AppRole | null {
  const order: AppRole[] = ["admin", "finance", "coach", "parent"];
  return order.find((r) => roles.includes(r)) ?? null;
}

export function homeForRoles(roles: AppRole[]): string {
  const r = primaryRole(roles);
  return r ? ROLE_HOME[r] : "/login";
}

export function hasAnyRole(roles: AppRole[], allowed: AppRole[]) {
  return roles.some((r) => allowed.includes(r));
}

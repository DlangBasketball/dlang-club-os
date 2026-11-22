import "server-only";
import { cache } from "react";
import { selectionDb } from "@/lib/selection/db";
import { sportsDb } from "@/lib/sportsops/db";
import { logError } from "@/lib/log";
import type { SessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getAssistantAccess } from "@/lib/ai/settings";
import { operationsHiddenHrefs } from "@/lib/operations/nav";
import { upgradeNav } from "@/lib/upgrades/nav";
import { zonedDayKey } from "@/lib/staff/hours";
import { ADMIN_ONLY_COMMS, ASSISTANT_HREF, SELECTION_HREF } from "@/components/layout/nav-config";
import type { AdminNavInput, SelectionNavProgram } from "@/components/layout/admin-nav";

/**
 * Reads behind the admin menu and the dashboard shortcuts. Signed-in user's
 * client (RLS) and the org from the session; cached per request so the
 * layout and the dashboard share one query.
 */

/**
 * Active selection programmes (switched on, not archived, not over) with
 * their active divisions, newest first.
 */
export const getActiveSelectionNav = cache(async (orgId: string, today: string): Promise<SelectionNavProgram[]> => {
  try {
    const db = await selectionDb();
    const { data: progs, error } = await db.from("programs").select("id,name,status,is_active,ends_on,archived_at")
      .eq("org_id", orgId).or("selection_enabled.eq.true,kind.eq.selection").eq("is_active", true).neq("status", "archived")
      .order("starts_on", { ascending: false, nullsFirst: false }).order("name");
    if (error) throw error;
    const live = (progs ?? []).filter((p) => !p.archived_at && !(p.ends_on && p.ends_on < today));
    if (!live.length) return [];
    const { data: divs, error: e2 } = await db.from("program_divisions").select("id,name,program_id,sort,is_active")
      .eq("org_id", orgId).in("program_id", live.map((p) => p.id)).eq("is_active", true).order("sort").order("name");
    if (e2) throw e2;
    return live.map((p) => ({
      id: p.id, name: p.name,
      divisions: (divs ?? []).filter((d) => d.program_id === p.id).map((d) => ({ id: d.id, name: d.name })),
    }));
  } catch (e) {
    logError("adminNav.selection", e);
    return [];
  }
});

export type AdminNavContext = AdminNavInput & { today: string; month: string };

/**
 * What shapes the admin menu for this user: roles, hidden entries (assistant
 * not available, admin-only pages for finance, board for non-committee staff,
 * modules the club hid), locked modules (Upgrade badge) and the active
 * selection programmes (only loaded when the user can see that group).
 */
export async function getAdminNavContext(user: SessionUser): Promise<AdminNavContext> {
  // Keyed by primitives so the layout and the dashboard share one computation per request.
  requestUsers().set(user.id, user);
  return navContext(user.id, user.orgId, user.roles.join(","));
}

/** Per-request lookup of the session user behind a cache key. */
const requestUsers = cache(() => new Map<string, SessionUser>());

const navContext = cache(async (id: string, _orgId: string | null, _roles: string): Promise<AdminNavContext> => {
  const user = requestUsers().get(id)!;
  const [{ ctx }, assistant, opsHidden, upg] = await Promise.all([
    getI18n(user.orgId), getAssistantAccess(user), operationsHiddenHrefs(user), upgradeNav(user, "admin"),
  ]);
  const today = zonedDayKey(new Date(), ctx.timeZone);
  // The assistant entry shows for admins even without the paid add-on (so
  // they can discover it and find the switch), and for everyone once it is on.
  const showAssistant =
    assistant.allowed ||
    (user.roles.includes("admin") && (assistant.reason === "disabled" || assistant.reason === "not_entitled"));
  const isAdmin = user.roles.includes("admin");
  const hidden = [...(showAssistant ? [] : [ASSISTANT_HREF]), ...(isAdmin ? [] : ADMIN_ONLY_COMMS), ...opsHidden, ...upg.hidden];
  const selectionUsable = isAdmin && ![...hidden, ...upg.locked].some((h) => h === SELECTION_HREF || SELECTION_HREF.startsWith(`${h}/`));
  const selection = user.orgId && selectionUsable ? await getActiveSelectionNav(user.orgId, today) : null;
  return { roles: user.roles, hidden, locked: upg.locked, selection, today, month: today.slice(0, 7) };
});

/** The club's current season (seasons.is_current), or null. */
export const getCurrentSeasonId = cache(async (orgId: string): Promise<string | null> => {
  try {
    const db = await sportsDb();
    const { data, error } = await db.from("seasons").select("id").eq("org_id", orgId).eq("is_current", true).maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  } catch (e) {
    logError("adminNav.season", e);
    return null;
  }
});

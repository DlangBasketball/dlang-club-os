import type { NamespaceKey } from "@/lib/i18n/translator";
import { programDivisionLabel, programShortName } from "@/lib/selection/arrangement";
import {
  ADMIN_NAV_GROUPS, ADMIN_NAV_PINNED, SELECTION_DIVISION_ICON, SELECTION_GROUP_KEY, SELECTION_HREF,
  SELECTION_PAYMENTS_KEY, SELECTION_TOURNAMENTS_KEY, type AdminNavDef, type AdminNavRole,
} from "./nav-config";

/**
 * Admin sidebar model (pure: built on the server in the admin layout, rendered
 * by the client shell, unit-tested). Plain data only, so it crosses the
 * server/client boundary: icons are looked up by `icon` key on the client.
 */

export type AdminNavEntry = {
  key: string;
  href: string;
  /** Icon key (ADMIN_NAV_ICONS). */
  icon: string;
  /** Catalog label under "nav." (translated + tenant terminology on the client)... */
  labelKey?: NamespaceKey<"nav">;
  labelParams?: Record<string, string>;
  /** ...or a label taken from club data (e.g. a programme division). */
  text?: string;
  /** Outside the club's plan: shown with the "Upgrade" badge. */
  locked?: boolean;
};
export type AdminNavGroup = { key: string; labelKey: NamespaceKey<"nav">; icon: string; items: AdminNavEntry[] };
export type AdminNavModel = { pinned: AdminNavEntry[]; groups: AdminNavGroup[] };

export type SelectionNavProgram = { id: string; name: string; divisions: { id: string; name: string }[] };

export type AdminNavInput = {
  roles: readonly string[];
  /** Destinations hidden for this user / club (prefix match: "/admin/finance" hides its sub-pages). */
  hidden?: readonly string[];
  /** Destinations outside the club's plan (prefix match), badge instead of hiding. */
  locked?: readonly string[];
  /** The club's active selection programmes; null = module not available / not loaded. */
  selection?: readonly SelectionNavProgram[] | null;
};

const pathOf = (href: string) => href.split(/[?#]/, 1)[0] ?? href;
const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);
const matchesAny = (href: string, list: readonly string[] | undefined) => {
  const p = pathOf(href);
  return !!list?.some((b) => under(p, b));
};

function canSee(def: { roles: readonly AdminNavRole[] }, roles: readonly string[]): boolean {
  return def.roles.some((r) => roles.includes(r));
}

/** The one programme the selection shortcuts point at (null when there are none or several). */
export function currentSelectionProgram(programs: readonly SelectionNavProgram[] | null | undefined): SelectionNavProgram | null {
  return programs && programs.length === 1 ? programs[0] : null;
}

/** Roster of one division: "/admin/selection/<id>?tab=players&division=<id>". */
export function divisionHref(programId: string, divisionId: string): string {
  return `${SELECTION_HREF}/${programId}?${new URLSearchParams({ tab: "players", division: divisionId }).toString()}`;
}

export function tournamentsHref(programs: readonly SelectionNavProgram[] | null | undefined): string {
  const cur = currentSelectionProgram(programs);
  return cur ? `${SELECTION_HREF}/${cur.id}?tab=setup#tournaments` : SELECTION_HREF;
}

/** One entry per division ("EYBL U14"); a label shared by two programmes gets the programme name. */
function divisionEntries(programs: readonly SelectionNavProgram[]): AdminNavEntry[] {
  const rows = programs.flatMap((p) => p.divisions.map((d) => ({ p, d, label: programDivisionLabel(p.name, d.name) })));
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.label, (count.get(r.label) ?? 0) + 1);
  return rows.map(({ p, d, label }) => ({
    key: `division:${d.id}`,
    href: divisionHref(p.id, d.id),
    icon: SELECTION_DIVISION_ICON,
    text: (count.get(label) ?? 0) > 1 ? `${label} · ${p.name}` : label,
  }));
}

function entryOf(def: AdminNavDef, input: AdminNavInput): AdminNavEntry {
  const cur = currentSelectionProgram(input.selection);
  const e: AdminNavEntry = { key: def.key, href: def.href, icon: def.key, labelKey: def.labelKey };
  if (def.key === SELECTION_TOURNAMENTS_KEY) e.href = tournamentsHref(input.selection);
  if (def.key === SELECTION_PAYMENTS_KEY && cur) {
    e.labelKey = "selectionPaymentsFor";
    e.labelParams = { name: programShortName(cur.name) };
  }
  if (matchesAny(e.href, input.locked)) e.locked = true;
  return e;
}

/**
 * The admin menu for one user: role-filtered, feature-gated (hidden entries
 * dropped, locked ones flagged), selection divisions built from data, empty
 * groups dropped.
 */
export function buildAdminNav(input: AdminNavInput): AdminNavModel {
  const visible = (d: AdminNavDef) => canSee(d, input.roles) && !matchesAny(d.href, input.hidden);
  const pinned = ADMIN_NAV_PINNED.filter(visible).map((d) => entryOf(d, input));
  const groups: AdminNavGroup[] = [];
  for (const g of ADMIN_NAV_GROUPS) {
    let items = g.items.filter(visible).map((d) => entryOf(d, input));
    if (g.key === SELECTION_GROUP_KEY && items.length > 0) {
      const selectionOpen = !matchesAny(SELECTION_HREF, input.locked);
      items = [...(selectionOpen ? divisionEntries(input.selection ?? []) : []), ...items];
    }
    if (items.length) groups.push({ key: g.key, labelKey: g.labelKey, icon: `group:${g.key}`, items });
  }
  return { pinned, groups };
}

type Params = { get(name: string): string | null } | null | undefined;

/**
 * The entry for the current page: the longest path that contains the
 * pathname wins; an entry with a query string ("?tab=players&division=…")
 * only counts when the URL carries the same values, and then beats the bare
 * path. Ties go to the entry listed first.
 */
export function activeNavKey(model: AdminNavModel, pathname: string, params?: Params): string | null {
  let best: { key: string; score: number } | null = null;
  for (const e of [...model.pinned, ...model.groups.flatMap((g) => g.items)]) {
    const [pathAndQuery] = e.href.split("#", 1);
    const [path, query = ""] = pathAndQuery.split("?", 2);
    if (!under(pathname, path)) continue;
    const want = Array.from(new URLSearchParams(query).entries());
    if (!want.every(([k, v]) => params?.get(k) === v)) continue;
    const score = path.length * 100 + want.length;
    if (!best || score > best.score) best = { key: e.key, score };
  }
  return best?.key ?? null;
}

/** The group holding the current page (opened automatically). */
export function activeGroupKey(model: AdminNavModel, pathname: string, params?: Params): string | null {
  const key = activeNavKey(model, pathname, params);
  if (!key) return null;
  return model.groups.find((g) => g.items.some((i) => i.key === key))?.key ?? null;
}

// ---------------------------------------------------------------------------
// Dashboard shortcuts
// ---------------------------------------------------------------------------

export type ShortcutKey = "findPlayer" | "addMembership" | "addToRoster" | "recordPayment" | "monthlyReport";
export type DashboardShortcut = { key: ShortcutKey; href: string; labelParams?: Record<string, string> };

export type ShortcutInput = AdminNavInput & {
  currentSeasonId?: string | null;
  /** Current month in the club's time zone, YYYY-MM. */
  month: string;
};

/**
 * Role- and plan-filtered shortcuts for the dashboard. A shortcut shows when
 * its menu entry would (same roles and gating); locked modules are left out
 * here (the menu already advertises them).
 */
export function buildDashboardShortcuts(input: ShortcutInput): DashboardShortcut[] {
  const cur = currentSelectionProgram(input.selection);
  const report = new URLSearchParams();
  if (input.currentSeasonId) report.set("season", input.currentSeasonId);
  report.set("month", input.month);
  const all: (DashboardShortcut & { roles: readonly AdminNavRole[] })[] = [
    { key: "findPlayer", href: "/admin/athletes?focus=search", roles: ["admin", "finance"] },
    { key: "addMembership", href: "/admin/memberships/new", roles: ["admin", "finance"] },
    {
      key: "addToRoster", href: cur ? `${SELECTION_HREF}/${cur.id}/players/new` : SELECTION_HREF, roles: ["admin"],
      ...(cur ? { labelParams: { name: programShortName(cur.name) } } : {}),
    },
    { key: "recordPayment", href: "/admin/payments/record", roles: ["admin", "finance"] },
    { key: "monthlyReport", href: `/admin/finance/club-membership-payments?${report.toString()}`, roles: ["admin", "finance"] },
  ];
  return all
    .filter((s) => canSee(s, input.roles) && !matchesAny(s.href, input.hidden) && !matchesAny(s.href, input.locked))
    .map(({ roles: _roles, ...s }) => s);
}

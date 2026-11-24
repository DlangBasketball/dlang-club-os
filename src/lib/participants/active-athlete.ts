/**
 * Active athlete of the parent app ("child switcher").
 *
 * The choice is a per-user, per-club preference stored in an httpOnly cookie
 * (`<userId>.<orgId>.<athleteId|all>`). It is only a hint: every read
 * validates it against the athletes the signed-in adult manages in the current
 * club (`my_athletes()` / `my_athlete_resolve()` in the database). A cookie of
 * another user or club, an unknown id or an athlete the adult no longer
 * manages is ignored.
 *
 * Pure functions (no server imports) so the rules are unit-tested.
 */

export const ACTIVE_ATHLETE_COOKIE = "clubos_active_athlete";
/** One year: a preference, not a session. */
export const ACTIVE_ATHLETE_MAX_AGE = 60 * 60 * 24 * 365;
/** Explicit "All athletes" choice (lists show every athlete). */
export const ALL_ATHLETES = "all";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export type ActiveAthleteCookie = { userId: string; orgId: string; athleteId: string | typeof ALL_ATHLETES };

export function encodeActiveAthleteCookie(c: ActiveAthleteCookie): string {
  return `${c.userId}.${c.orgId}.${c.athleteId}`;
}

/** Parse a raw cookie value; null when malformed. */
export function parseActiveAthleteCookie(raw: string | null | undefined): ActiveAthleteCookie | null {
  if (!raw || raw.length > 200) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [userId, orgId, athleteId] = parts;
  if (!isUuid(userId) || !isUuid(orgId)) return null;
  if (athleteId !== ALL_ATHLETES && !isUuid(athleteId)) return null;
  return { userId: userId.toLowerCase(), orgId: orgId.toLowerCase(), athleteId: athleteId === ALL_ATHLETES ? ALL_ATHLETES : athleteId.toLowerCase() };
}

/**
 * The validated active athlete: the cookie's athlete when the cookie belongs
 * to this user + club AND the athlete is one of `authorisedIds`; "all" when
 * the user chose all; otherwise null (no preference).
 */
export function resolveActiveAthlete(opts: {
  cookie: string | null | undefined;
  userId: string;
  orgId: string;
  authorisedIds: readonly string[];
}): string | typeof ALL_ATHLETES | null {
  const c = parseActiveAthleteCookie(opts.cookie);
  if (!c) return null;
  if (c.userId !== opts.userId.toLowerCase() || c.orgId !== opts.orgId.toLowerCase()) return null;
  if (c.athleteId === ALL_ATHLETES) return ALL_ATHLETES;
  const ids = new Set(opts.authorisedIds.map((x) => x.toLowerCase()));
  return ids.has(c.athleteId) ? c.athleteId : null;
}

export type AthleteFilter = { mode: "all" } | { mode: "one"; athleteId: string };

/**
 * Which athlete a per-athlete page shows.
 *   1. an explicit `?athlete=` param wins (a valid authorised id, or "all"
 *      where the page lists several athletes);
 *   2. else the active athlete from the switcher;
 *   3. else "all" (lists) or the first athlete (single-athlete pages).
 * Unauthorised / stale ids are ignored at every step.
 */
export function resolveAthleteFilter(opts: {
  param: string | string[] | null | undefined;
  active: string | typeof ALL_ATHLETES | null;
  authorisedIds: readonly string[];
  allowAll: boolean;
}): AthleteFilter {
  const ids = opts.authorisedIds.map((x) => x.toLowerCase());
  const raw = Array.isArray(opts.param) ? opts.param[0] : opts.param;
  const p = typeof raw === "string" ? raw.trim().toLowerCase() : null;
  const pick = (v: string | null): AthleteFilter | null => {
    if (!v) return null;
    if (v === ALL_ATHLETES) return opts.allowAll ? { mode: "all" } : null;
    return ids.includes(v) ? { mode: "one", athleteId: v } : null;
  };
  const chosen = pick(p) ?? pick(opts.active);
  if (chosen) return chosen;
  if (opts.allowAll || ids.length === 0) return { mode: "all" };
  return { mode: "one", athleteId: ids[0] };
}

/** Keep the rows of the filtered athlete (all rows for "all"). */
export function filterByAthlete<T>(rows: readonly T[], filter: AthleteFilter, athleteOf: (row: T) => string | null | undefined): T[] {
  if (filter.mode === "all") return [...rows];
  return rows.filter((r) => (athleteOf(r) ?? "").toLowerCase() === filter.athleteId);
}

/** The athlete a booking / request form preselects: the active one when it is a valid choice there. */
export function preselectAthlete(active: string | typeof ALL_ATHLETES | null, choices: readonly string[]): string | null {
  if (!active || active === ALL_ATHLETES) return null;
  return choices.some((c) => c.toLowerCase() === active) ? active : null;
}

/** "Myself" is offered only when the activity accepts adults (no upper age limit below 18). */
export function acceptsAdults(maxAge: number | null | undefined): boolean {
  return maxAge === null || maxAge === undefined || maxAge >= 18;
}

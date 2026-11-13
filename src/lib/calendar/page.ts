import "server-only";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { staffDb } from "@/lib/staff/db";
import { zonedDayKey } from "@/lib/staff/hours";
import { applyFilters, isCalendarKind, isCalendarView, viewRange, type CalendarItem } from "./aggregate";
import { loadCalendarItems, resolveScope, type CalendarAudience } from "./data";
import type { CalendarQuery } from "@/components/calendar/calendar-view";

export type CalendarSearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseCalendarQuery(sp: CalendarSearchParams, today: string, defaultView: CalendarQuery["view"] = "month"): CalendarQuery {
  const view = isCalendarView(one(sp.view)) ? (one(sp.view) as CalendarQuery["view"]) : defaultView;
  const date = one(sp.date);
  const kindsRaw = sp.kind === undefined ? [] : Array.isArray(sp.kind) ? sp.kind : [sp.kind];
  const id = (v: string | undefined) => (v && UUID.test(v) ? v : null);
  return {
    view,
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : today,
    kinds: kindsRaw.filter(isCalendarKind),
    team: id(one(sp.team)),
    coach: id(one(sp.coach)),
    venue: id(one(sp.venue)),
  };
}

/** Everything a calendar page needs for the signed-in user and audience. */
export async function loadCalendarPage(audience: CalendarAudience, sp: CalendarSearchParams, defaultView: CalendarQuery["view"] = "month") {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  if (!me?.orgId) return null;
  const today = zonedDayKey(new Date(), f.timeZone);
  const q = parseCalendarQuery(sp, today, defaultView);
  const firstDow = f.firstDayOfWeek();
  const { from, to } = viewRange(q.view, q.date, firstDow);
  const db = await staffDb();
  const scope = await resolveScope(db, me.orgId, me.id, audience);
  let items: CalendarItem[] = [];
  let error: string | null = null;
  try {
    items = await loadCalendarItems(db, scope, { from, to, timeZone: f.timeZone }, t);
  } catch {
    error = t("staff.errors.generic");
  }
  const filtered = applyFilters(items, { kinds: q.kinds, teamId: q.team, coachId: q.coach, venueId: q.venue });
  const { data: feed } = await db.from("calendar_feed_tokens").select("id,created_at,last_used_at")
    .eq("org_id", me.orgId).eq("profile_id", me.id).is("revoked_at", null).maybeSingle();
  return { t, f, me, q, from, to, firstDow, items: filtered, error, hasFeed: !!feed, orgId: me.orgId };
}

import { buildIcs } from "@/lib/calendar/ics";
import type { CalendarItem } from "@/lib/calendar/aggregate";
import { loadPublicEvents } from "@/lib/website/public-data";
import { getWebsiteSettings } from "@/lib/website/server";
import { getRequestSite, siteI18n } from "@/lib/site/server";
import { logError } from "@/lib/log";

/**
 * Club calendar subscription for the site's "calendar" block (webcal / .ics):
 * public games, tournaments and club events of the host's club (next 400 days,
 * public data layer only). 404 when the site is off or the club hides events.
 */
export async function GET(): Promise<Response> {
  const site = await getRequestSite();
  if (!site) return new Response("Not found", { status: 404 });
  const settings = await getWebsiteSettings(site.orgId);
  if (!settings.sections.events) return new Response("Not found", { status: 404 });
  try {
    const { t, f } = siteI18n(site.settings.defaultLanguage, site.tenant, site.settings.defaultLanguage);
    const now = new Date();
    const events = await loadPublicEvents(
      { club: { tenant: site.tenant, settings }, t, f, appUrl: site.origin },
      { from: now.toISOString(), to: new Date(now.getTime() + 400 * 864e5).toISOString() },
    );
    const items: CalendarItem[] = events.map((e) => ({
      id: `site:${e.id}`, kind: "team_event", sourceId: e.id, title: e.title, subtype: e.type, start: e.starts_at, end: e.ends_at, allDay: false,
      location: e.venue ? [e.venue.name, e.venue.address].filter(Boolean).join(", ") : null, venueId: null, teamId: null, coachIds: [], profileId: null,
      status: e.status === "cancelled" ? "cancelled" : "scheduled", href: null, color: null, description: null,
    }));
    let domain = "club.app";
    try {
      domain = new URL(site.origin).host || domain;
    } catch {
      /* default */
    }
    return new Response(buildIcs(items, { calendarName: site.tenant.name, domain }), {
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="calendar.ics"', "Cache-Control": "public, s-maxage=900" },
    });
  } catch (e) {
    logError("site.calendar", e);
    return new Response("Error", { status: 500 });
  }
}

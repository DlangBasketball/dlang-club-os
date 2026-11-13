import { createHash } from "node:crypto";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import { staffAdminDb } from "@/lib/staff/db";
import { addDayKey, zonedDayKey } from "@/lib/staff/hours";
import { loadCalendarItems, resolveScope, type CalendarAudience } from "@/lib/calendar/data";
import { buildIcs } from "@/lib/calendar/ics";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only ICS subscription feed: GET /api/calendar/feed/<token>.
 *
 * The token (32 random bytes, base64url) is the only credential; it maps via
 * its SHA-256 hash to one user of one club. The feed is built with the
 * service client but every query is filtered by that user's org and scope
 * (src/lib/calendar/data.ts), so it never shows more than the app does.
 * Revoked or unknown tokens get a plain 404 (no hint whether it existed).
 */
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = token.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(raw)) return notFound();
  const hash = createHash("sha256").update(raw).digest("hex");

  try {
    const db = staffAdminDb();
    const { data: feed } = await db.from("calendar_feed_tokens").select("id,org_id,profile_id,last_used_at")
      .eq("token_hash", hash).is("revoked_at", null).maybeSingle();
    if (!feed) return notFound();

    const [{ data: profile }, { data: org }, { data: settings }, { data: roles }, { data: families }] = await Promise.all([
      db.from("profiles").select("id,org_id,locale,is_active").eq("id", feed.profile_id).maybeSingle(),
      db.from("organizations").select("*").eq("id", feed.org_id).maybeSingle(),
      db.from("app_settings").select("*").eq("org_id", feed.org_id).maybeSingle(),
      db.from("staff_roles").select("role").eq("org_id", feed.org_id).eq("profile_id", feed.profile_id),
      db.from("family_members").select("family_id").eq("profile_id", feed.profile_id),
    ]);
    // The user must still belong to that club.
    if (!profile || profile.org_id !== feed.org_id || profile.is_active === false || !org) return notFound();

    const roleSet = new Set((roles ?? []).map((r) => r.role as string));
    let audience: CalendarAudience | null = roleSet.has("admin") ? "admin" : roleSet.has("coach") || roleSet.has("finance") ? "coach" : null;
    if (!audience && (families ?? []).length) {
      const { count } = await db.from("families").select("id", { count: "exact", head: true })
        .eq("org_id", feed.org_id).in("id", (families ?? []).map((f) => f.family_id));
      if ((count ?? 0) > 0) audience = "parent";
    }
    if (!audience) return notFound();

    const tzOf = (row: unknown) => {
      const v = row && typeof row === "object" ? (row as Record<string, unknown>).timezone : null;
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const orgTz = tzOf(settings) ?? tzOf(org) ?? "UTC";
    const { t } = getStandaloneI18n({ locale: profile.locale, country: org.country, timeZone: orgTz });
    const today = zonedDayKey(new Date(), orgTz);
    const scope = await resolveScope(db, feed.org_id, feed.profile_id, audience);
    const items = await loadCalendarItems(db, scope, { from: addDayKey(today, -30), to: addDayKey(today, 180), timeZone: orgTz }, t);

    if (!feed.last_used_at || Date.now() - Date.parse(feed.last_used_at) > 3600_000) {
      await db.from("calendar_feed_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", feed.id);
    }

    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const body = buildIcs(items, {
      calendarName: t("staff.calendar.subscribe.feedName", { club: org.name }),
      domain: host.replace(/:\d+$/, ""),
      baseUrl: `${proto}://${host}`,
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="calendar.ics"',
        "Cache-Control": "private, max-age=900",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    logError("calendar.feed", e);
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

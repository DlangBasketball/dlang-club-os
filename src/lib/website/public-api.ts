import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import { LOCALES, normalizeLocale } from "@/lib/i18n/config";
import { tenantReturnOrigin } from "@/lib/tenant/url";
import { buildIcs } from "@/lib/calendar/ics";
import type { CalendarItem } from "@/lib/calendar/aggregate";
import { logError } from "@/lib/log";
import { corsHeaders } from "./origins";
import { PUBLIC_API_LIMIT, PUBLIC_API_WINDOW_MS, clientIp, createRateLimiter } from "./rate-limit";
import { resolvePublicClub, type PublicClub } from "./server";
import type { PublicSection } from "./settings-shape";
import {
  buildCampaigns, buildCamps, buildClub, buildCoaches, buildNews, buildPlacements, buildPrograms, buildShop, buildTeams, buildTraining,
  clubEnvelope, loadPublicEvents, type Ctx,
} from "./public-data";

/**
 * Request handling of the public website API: rate limit, zod-validated
 * query, club resolution (server-side; 404 unless the website connection is
 * enabled), CORS, caching + ETag. The builders in ./public-data read the data.
 */

export const PUBLIC_RESOURCES = ["club", "programs", "camps", "events", "results", "teams", "coaches", "training", "shop", "campaigns", "news", "calendar.ics", "placements"] as const;
export type PublicResource = (typeof PUBLIC_RESOURCES)[number];

const SECTION: Record<PublicResource, PublicSection | null> = {
  club: null, programs: "programs", camps: "camps", events: "events", results: "results", teams: "teams", coaches: "coaches",
  training: "training", shop: "shop", campaigns: "campaigns", news: "news", "calendar.ics": "events", placements: "placements",
};

const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
const limiter = createRateLimiter({ limit: PUBLIC_API_LIMIT, windowMs: PUBLIC_API_WINDOW_MS });

/** Test hook: clear the in-memory rate limiter. */
export function resetPublicApiRateLimit(): void {
  limiter.reset();
}

const slugLike = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const dateLike = z.string().trim().max(40).refine((v) => !Number.isNaN(Date.parse(v)), "date");
const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z.string().max(200).transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)).pipe(z.array(z.enum(values)).max(values.length));

const baseQuery = z.object({
  club: slugLike.optional(),
  lang: z.enum(LOCALES).optional(),
});
const QUERY: Record<PublicResource, z.ZodTypeAny> = {
  club: baseQuery,
  programs: baseQuery.extend({ kind: csv(["team", "camp", "clinic", "tournament"]).optional(), season: z.enum(["spring", "summer", "fall", "winter", "other"]).optional() }),
  camps: baseQuery.extend({ season: z.enum(["spring", "summer", "fall", "winter", "other"]).optional(), year: z.coerce.number().int().min(2000).max(2100).optional() }),
  events: baseQuery.extend({ from: dateLike.optional(), to: dateLike.optional(), team: slugLike.optional(), type: csv(["game", "training", "event", "tournament"]).optional() }),
  results: baseQuery.extend({ team: slugLike.optional(), season: z.string().trim().min(1).max(80).optional() }),
  teams: baseQuery,
  coaches: baseQuery,
  training: baseQuery,
  shop: baseQuery.extend({ category: z.string().trim().min(1).max(80).optional() }),
  campaigns: baseQuery,
  news: baseQuery.extend({ limit: z.coerce.number().int().min(1).max(50).optional() }),
  placements: baseQuery.extend({ limit: z.coerce.number().int().min(1).max(100).optional() }),
  "calendar.ics": baseQuery.extend({ from: dateLike.optional(), to: dateLike.optional(), team: slugLike.optional(), type: csv(["game", "training", "event", "tournament"]).optional() }),
};

function isResource(v: string): v is PublicResource {
  return (PUBLIC_RESOURCES as readonly string[]).includes(v);
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

/** Query params with the range of the events window clamped (max 400 days). */
function clampRange(from?: string, to?: string): { from?: string; to?: string } {
  if (!from || !to) return { from, to };
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (b < a) return { from, to: from };
  if (b - a > 400 * 864e5) return { from, to: new Date(a + 400 * 864e5).toISOString() };
  return { from, to };
}

export async function buildResource(resource: PublicResource, ctx: Ctx, q: Record<string, unknown>): Promise<unknown> {
  const section = SECTION[resource];
  if (section && !ctx.club.settings.sections[section]) return resource === "club" ? null : [];
  switch (resource) {
    case "club": return buildClub(ctx);
    case "programs": return buildPrograms(ctx, { kind: q.kind as string[] | undefined, season: (q.season as string) ?? null });
    case "camps": return buildCamps(ctx, { season: (q.season as string) ?? null, year: (q.year as number) ?? null });
    case "events":
    case "calendar.ics": {
      const r = clampRange(q.from as string | undefined, q.to as string | undefined);
      return loadPublicEvents(ctx, { from: r.from ?? null, to: r.to ?? null, team: (q.team as string) ?? null, type: q.type as string[] | undefined });
    }
    case "results": return loadPublicEvents(ctx, { team: (q.team as string) ?? null, season: (q.season as string) ?? null, pastOnly: true });
    case "teams": return buildTeams(ctx);
    case "coaches": return buildCoaches(ctx);
    case "training": return buildTraining(ctx);
    case "shop": return buildShop(ctx, { category: (q.category as string) ?? null });
    case "campaigns": return buildCampaigns(ctx);
    case "news": return buildNews(ctx, { limit: q.limit as number | undefined });
    case "placements": return buildPlacements(ctx, { limit: q.limit as number | undefined });
  }
}

export function contextFor(club: PublicClub, lang: string | undefined, requestHost: string | null): Ctx {
  const t = club.tenant;
  const locale = normalizeLocale(lang) ?? normalizeLocale(t.defaultLocale) ?? "en";
  const { t: tr, f } = getStandaloneI18n({ locale, country: t.country, currency: t.currency, timeZone: t.timezone });
  const appUrl = tenantReturnOrigin({ slug: t.slug, customDomain: t.customDomain }, requestHost);
  return { club, t: tr, f, appUrl };
}

function etagOf(payload: unknown): string {
  return `W/"${createHash("sha1").update(JSON.stringify(payload)).digest("base64url").slice(0, 27)}"`;
}

function icsFor(ctx: Ctx, events: Awaited<ReturnType<typeof loadPublicEvents>>): string {
  const items: CalendarItem[] = events.map((e) => ({
    id: `public:${e.id}`, kind: "team_event", sourceId: e.id, title: e.title, subtype: e.type, start: e.starts_at, end: e.ends_at,
    allDay: false, location: e.venue ? [e.venue.name, e.venue.address].filter(Boolean).join(", ") : null, venueId: null,
    teamId: null, coachIds: [], profileId: null, status: e.status === "cancelled" ? "cancelled" : "scheduled", href: null, color: null,
    description: e.result ? `${e.result.our_score}:${e.result.their_score}` : null,
  }));
  let domain = "club.app";
  try {
    domain = new URL(ctx.appUrl).host || domain;
  } catch {
    /* keep default */
  }
  return buildIcs(items, { calendarName: ctx.club.tenant.name, domain });
}

export async function handlePublicApiOptions(req: Request, resource: string): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  if (!isResource(resource)) return new Response(null, { status: 404, headers: { Vary: "Origin" } });
  const club = await resolvePublicClub(url.searchParams.get("club")).catch(() => null);
  return new Response(null, { status: 204, headers: corsHeaders(origin, club?.settings.allowedOrigins ?? []) });
}

export async function handlePublicApi(req: Request, resource: string): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  const rl = limiter.check(clientIp(req.headers));
  if (!rl.ok) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))), Vary: "Origin", "Cache-Control": "no-store" });
  }
  if (!isResource(resource)) return json({ error: "not_found" }, 404, { Vary: "Origin" });

  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = QUERY[resource].safeParse(raw);
  if (!parsed.success) return json({ error: "invalid_query", fields: parsed.error.issues.map((i) => i.path.join(".")) }, 400, { Vary: "Origin" });
  const q = parsed.data as Record<string, unknown>;

  let club: PublicClub | null;
  try {
    club = await resolvePublicClub(q.club as string | undefined);
  } catch (e) {
    logError("website.api.club", e);
    club = null;
  }
  if (!club) return json({ error: "not_found" }, 404, { Vary: "Origin", "Cache-Control": "public, s-maxage=60" });
  const cors = corsHeaders(origin, club.settings.allowedOrigins);

  try {
    const ctx = contextFor(club, q.lang as string | undefined, req.headers.get("host"));
    const data = await buildResource(resource, ctx, q);
    if (resource === "calendar.ics") {
      const body = icsFor(ctx, data as Awaited<ReturnType<typeof loadPublicEvents>>);
      const etag = etagOf(body);
      const headers = { ...cors, "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": CACHE_CONTROL, ETag: etag };
      if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
      return new Response(body, { status: 200, headers });
    }
    const envelope = clubEnvelope(ctx);
    const etag = etagOf({ envelope, data });
    const headers = { ...cors, "Cache-Control": CACHE_CONTROL, ETag: etag };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return json({ club: envelope, data, generated_at: new Date().toISOString() }, 200, headers);
  } catch (e) {
    logError("website.api", e, { resource });
    return json({ error: "server_error" }, 500, { ...cors, "Cache-Control": "no-store" });
  }
}

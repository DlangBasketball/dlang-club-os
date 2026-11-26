import "server-only";
import { listSeasonCamps } from "@/lib/camps/data";
import { coverUrlOf } from "@/lib/camps/data";
import { getStorefront } from "@/lib/shop/data";
import { getPublicCatalog } from "@/lib/training/data";
import { campaignOpen, campaignProgress } from "@/lib/operations/fundraising";
import { isLibraryPath, clubMediaPublicUrl } from "@/lib/media/cover";
import { getOrgCover } from "@/lib/media/server";
import { zonedDayKey } from "@/lib/staff/hours";
import type { Formatter } from "@/lib/format";
import type { Translator } from "@/lib/i18n/translator";
import { LOCALES } from "@/lib/i18n/config";
import { logError } from "@/lib/log";
import { hasFeature } from "@/lib/upgrades/server";
import { escapeHtml, htmlToText, sanitizeHtml } from "./sanitize";
import { sanitizeRosterRows, type PublicRosterEntry } from "./roster";
import { embedThemeVars } from "./theme";
import { websiteDb, type PublicClub, type WebsiteDb } from "./server";

/**
 * Builders of the public website API (docs/website/PUBLIC_API_CONTRACT.md).
 * Each takes the server-resolved club and returns the `data` of one
 * endpoint. Only rows of that club AND marked public are read (service role,
 * explicit org_id filter on every query). No personal data of members:
 * no athletes, families, registrations or donors, only counts; coaches only
 * when the club marked them public; rosters only through
 * public.website_public_roster() (media consent, first name + initial).
 */

export type Money = { amount: number; currency: string; formatted: string };
export type Ctx = {
  club: PublicClub;
  t: Translator;
  f: Formatter;
  appUrl: string;
  db?: WebsiteDb;
  now?: Date;
};

const db = (c: Ctx) => c.db ?? websiteDb();
const orgOf = (c: Ctx) => c.club.tenant.id;
const link = (c: Ctx, path: string) => `${c.appUrl.replace(/\/+$/, "")}${path}`;
const money = (c: Ctx, amount: number | string | null | undefined, currency?: string | null): Money | null => {
  if (amount === null || amount === undefined || amount === "" || !Number.isFinite(Number(amount))) return null;
  const cur = (currency || c.club.tenant.currency || c.f.currency).toUpperCase();
  return { amount: Number(amount), currency: cur, formatted: c.f.money(Number(amount), cur) };
};
const textHtml = (s: string | null | undefined): string | null => (s ? escapeHtml(s).replace(/\r?\n/g, "<br>") : null);

// ---------------------------------------------------------------------------
// club
// ---------------------------------------------------------------------------
export function clubEnvelope(c: Ctx) {
  const t = c.club.tenant;
  return {
    slug: t.slug,
    name: t.name,
    logo_url: t.branding.logoUrl,
    theme: embedThemeVars(t.branding, c.club.settings.embedTheme),
    locale: c.t.locale,
    currency: t.currency,
    app_url: c.appUrl,
  };
}

export async function buildClub(c: Ctx) {
  const t = c.club.tenant;
  const s = c.club.settings;
  const [{ data: as }, cover] = await Promise.all([
    db(c).from("app_settings").select("settings").eq("org_id", orgOf(c)).maybeSingle(),
    getOrgCover(orgOf(c)),
  ]);
  const profile = ((as?.settings as Record<string, unknown> | null)?.profile ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const navItems = ([
    ["camps", "/register/camps"], ["programs", "/club"], ["schedule", "/club/schedule"], ["book", `/book/${t.slug}`],
    ["shop", "/shop"], ["donate", "/club#donate"], ["login", "/login"],
  ] as const).map(([key, path]) => ({ key, label: c.t(`website.nav.${key}`), url: link(c, path) }));
  const languages = (t.supportedLocales.length ? t.supportedLocales : [t.defaultLocale]).filter((l) => (LOCALES as readonly string[]).includes(l));
  return {
    name: t.name,
    tagline: s.tagline,
    contact: s.sections.contact
      ? { email: str(profile.contact_email), phone: str(profile.contact_phone), address: str(profile.address) }
      : { email: null, phone: null, address: null },
    social: s.socialLinks,
    logo_url: t.branding.logoUrl,
    cover_url: cover.path && isLibraryPath(cover.path, orgOf(c)) ? cover.url : null,
    theme: embedThemeVars(t.branding, s.embedTheme),
    languages,
    website_url: s.websiteUrl,
    website_nav: s.navLinks.map((l) => ({ label: l.label, url: l.url.startsWith("/") ? link(c, l.url) : l.url })),
    // nav: key -> app URL (the WordPress plugin reads nav.login etc.);
    // nav_items: the same links with translated labels, in display order.
    nav: Object.fromEntries(navItems.map((n) => [n.key, n.url])),
    nav_items: navItems,
  };
}

// ---------------------------------------------------------------------------
// programs
// ---------------------------------------------------------------------------
const KIND_OUT: Record<string, string> = { camp: "camp", recurring_team: "team", clinic: "clinic", tournament: "tournament", selection: "selection" };
const KIND_IN: Record<string, string> = { camp: "camp", team: "recurring_team", clinic: "clinic", tournament: "tournament", selection: "selection" };

type ProgramRow = {
  id: string; slug: string | null; name: string; kind: string; description: string | null; price_chf: number | string | null;
  currency: string | null; capacity: number | null; starts_on: string | null; ends_on: string | null; location: string | null;
  min_age: number | null; max_age: number | null; registration_opens_at: string | null; registration_closes_at: string | null;
  season: string | null; cover_path: string | null;
};

export function programStatus(p: Pick<ProgramRow, "registration_opens_at" | "registration_closes_at" | "ends_on" | "starts_on">, placesLeft: number | null, now: Date): "open" | "full" | "closed" {
  const t = now.getTime();
  if (p.registration_opens_at && t < Date.parse(p.registration_opens_at)) return "closed";
  if (p.registration_closes_at && t >= Date.parse(p.registration_closes_at)) return "closed";
  const last = p.ends_on ?? p.starts_on;
  if (last && last < now.toISOString().slice(0, 10)) return "closed";
  if (placesLeft === 0) return "full";
  return "open";
}

function ageRange(c: Ctx, min: number | null, max: number | null) {
  if (min === null && max === null) return null;
  const label = min !== null && max !== null ? c.t("website.ages.range", { min, max }) : min !== null ? c.t("website.ages.from", { min }) : c.t("website.ages.upTo", { max: max! });
  return { min, max, label };
}

export async function buildPrograms(c: Ctx, q: { kind?: string[]; season?: string | null }) {
  const now = c.now ?? new Date();
  let query = db(c).from("programs")
    .select("id,slug,name,kind,description,price_chf,currency,capacity,starts_on,ends_on,location,min_age,max_age,registration_opens_at,registration_closes_at,season,cover_path")
    .eq("org_id", orgOf(c)).eq("is_public", true).eq("is_active", true).eq("status", "published").is("archived_at", null).not("slug", "is", null);
  const kinds = (q.kind ?? []).map((k) => KIND_IN[k]).filter(Boolean);
  if (kinds.length) query = query.in("kind", kinds);
  if (q.season) query = query.eq("season", q.season);
  const { data, error } = await query.order("starts_on", { ascending: true, nullsFirst: false }).limit(200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ProgramRow[];
  const ids = rows.map((r) => r.id);
  const [regs, opts] = await Promise.all([
    ids.length ? db(c).from("registrations").select("program_id,status").eq("org_id", orgOf(c)).in("program_id", ids).in("status", ["pending", "confirmed"]) : Promise.resolve({ data: [] }),
    ids.length ? db(c).from("camp_price_options").select("program_id,price,currency").eq("org_id", orgOf(c)).in("program_id", ids).eq("is_active", true) : Promise.resolve({ data: [] }),
  ]);
  const taken = new Map<string, number>();
  for (const r of (regs.data ?? []) as { program_id: string }[]) taken.set(r.program_id, (taken.get(r.program_id) ?? 0) + 1);
  return rows.map((p) => {
    const optPrices = ((opts.data ?? []) as { program_id: string; price: number | string }[]).filter((o) => o.program_id === p.id).map((o) => Number(o.price));
    const placesLeft = p.capacity === null ? null : Math.max(0, p.capacity - (taken.get(p.id) ?? 0));
    const priceFrom = optPrices.length ? Math.min(...optPrices) : Number(p.price_chf ?? 0);
    const url = link(c, `/register/${encodeURIComponent(p.slug!)}`);
    return {
      id: p.id, slug: p.slug, name: p.name, kind: KIND_OUT[p.kind] ?? p.kind,
      age_range: ageRange(c, p.min_age, p.max_age), level: null,
      description: textHtml(p.description),
      cover_url: coverUrlOf(p.cover_path), location: p.location,
      starts_on: p.starts_on, ends_on: p.ends_on,
      dates_formatted: p.starts_on && p.ends_on ? c.f.dateRange(p.starts_on, p.ends_on) : p.starts_on ? c.f.date(p.starts_on) : null,
      price_from: money(c, priceFrom, p.currency), places_left: placesLeft,
      status: programStatus(p, placesLeft, now), url, action_url: url,
    };
  });
}

// ---------------------------------------------------------------------------
// camps (season groups)
// ---------------------------------------------------------------------------
export async function buildCamps(c: Ctx, q: { season?: string | null; year?: number | null }) {
  const cards = await listSeasonCamps(orgOf(c), { publicOnly: true });
  const ids = cards.map((k) => k.id);
  const [{ data: opts }, { data: progs }] = await Promise.all([
    ids.length ? db(c).from("camp_price_options").select("id,program_id,edition_id,label,days_count,includes_lunch,price,member_price,currency,sort")
      .eq("org_id", orgOf(c)).in("program_id", ids).eq("is_active", true).order("sort") : Promise.resolve({ data: [] }),
    ids.length ? db(c).from("programs").select("id,min_age,max_age").eq("org_id", orgOf(c)).in("id", ids) : Promise.resolve({ data: [] }),
  ]);
  type Opt = { id: string; program_id: string; edition_id: string | null; label: string; days_count: number; includes_lunch: boolean; price: number | string; member_price: number | string | null; currency: string | null };
  const ages = new Map(((progs ?? []) as { id: string; min_age: number | null; max_age: number | null }[]).map((p) => [p.id, p]));
  const groups = new Map<string, { season: string; year: number | null; cards: typeof cards }>();
  for (const card of cards) {
    const season = card.season?.season ?? "other";
    const year = card.season?.year ?? null;
    if (q.season && season !== q.season) continue;
    if (q.year && year !== q.year) continue;
    const key = `${season}-${year ?? ""}`;
    if (!groups.has(key)) groups.set(key, { season, year, cards: [] });
    groups.get(key)!.cards.push(card);
  }
  return Array.from(groups.values()).map((g) => {
    const first = g.cards[0]!;
    const seasonName = c.t.dynamic(`camps.seasons.names.${g.season}`, {}, g.season);
    return {
      season: g.season,
      year: g.year,
      title: g.year ? c.t("camps.seasons.label", { season: seasonName, year: g.year }) : seasonName,
      url: g.cards.length === 1 && first.slug ? link(c, `/register/${encodeURIComponent(first.slug)}`) : link(c, `/register/camps${first.slug ? `?camp=${encodeURIComponent(first.slug)}` : ""}`),
      editions: g.cards.flatMap((card) => {
        const a = ages.get(card.id);
        const cardOpts = ((opts ?? []) as Opt[]).filter((o) => o.program_id === card.id);
        return card.weeks.map((w) => ({
          id: w.id,
          camp: card.name,
          name: w.name ?? card.name,
          dates: { starts_on: w.startsOn, ends_on: w.endsOn, formatted: c.f.dateRange(w.startsOn, w.endsOn) },
          venue: { name: w.venueName, city: w.city },
          ages: ageRange(c, a?.min_age ?? null, a?.max_age ?? null),
          cover_url: card.coverUrl,
          price_options: cardOpts.filter((o) => o.edition_id === null || o.edition_id === w.id).map((o) => ({
            id: o.id, label: o.label, days: o.days_count, lunch: o.includes_lunch,
            price: money(c, o.price, o.currency ?? card.currency), member_price: money(c, o.member_price, o.currency ?? card.currency),
          })),
          places_left: w.spotsLeft,
          status: w.open ? "open" : w.spotsLeft === 0 ? "full" : "closed",
          action_url: card.slug ? link(c, `/register/${encodeURIComponent(card.slug)}?edition=${encodeURIComponent(w.id)}`) : null,
        }));
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// events / results / calendar
// ---------------------------------------------------------------------------
type EventRow = {
  id: string; team_id: string | null; season_id: string | null; type: string; title: string | null; venue_id: string | null;
  location_text: string | null; starts_at: string; ends_at: string; opponent: string | null; home_away: string | null;
  status: string; is_public: boolean | null;
};
type TeamRow = { id: string; slug: string | null; name: string; age_group: string | null; level: string | null; league: string | null; cover_path: string | null; cover_public: boolean; roster_public: boolean };
type VenueRow = { id: string; name: string; address: string | null; city: string | null; postal_code: string | null };

const TYPE_OUT: Record<string, string> = { game: "game", training: "training", tournament: "tournament", meeting: "event", other: "event" };
const STATUS_OUT: Record<string, string> = { scheduled: "scheduled", completed: "scheduled", cancelled: "cancelled", postponed: "moved" };

async function publicTeams(c: Ctx): Promise<TeamRow[]> {
  const { data } = await db(c).from("teams").select("id,slug,name,age_group,level,league,cover_path,cover_public,roster_public")
    .eq("org_id", orgOf(c)).eq("is_public", true).eq("is_active", true).order("name");
  return (data ?? []) as TeamRow[];
}

function mapsUrl(v: VenueRow | null, fallback: string | null): string | null {
  const q = v ? [v.name, v.address, v.postal_code, v.city].filter(Boolean).join(", ") : fallback;
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

export type EventQuery = { from?: string | null; to?: string | null; team?: string | null; type?: string[]; season?: string | null; pastOnly?: boolean };

export async function loadPublicEvents(c: Ctx, q: EventQuery) {
  const now = c.now ?? new Date();
  const teams = await publicTeams(c);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamFilter = q.team ? teams.find((t) => t.slug === q.team || t.id === q.team) ?? null : null;
  if (q.team && !teamFilter) return [];
  const from = q.from ? new Date(q.from) : q.pastOnly ? new Date(now.getTime() - 365 * 864e5) : now;
  const to = q.to ? new Date(q.to) : q.pastOnly ? now : new Date(now.getTime() + 60 * 864e5);
  const typesIn = (q.type ?? []).flatMap((t) => (t === "event" ? ["meeting", "other"] : [t]));
  let query = db(c).from("events")
    .select("id,team_id,season_id,type,title,venue_id,location_text,starts_at,ends_at,opponent,home_away,status,is_public")
    .eq("org_id", orgOf(c)).gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString())
    .or("is_public.is.null,is_public.eq.true");
  if (teamFilter) query = query.eq("team_id", teamFilter.id);
  if (typesIn.length) query = query.in("type", typesIn);
  if (q.pastOnly) query = query.in("type", ["game", "tournament"]);
  if (q.season) {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q.season);
    const { data: s } = await db(c).from("seasons").select("id").eq("org_id", orgOf(c)).eq(isId ? "id" : "name", q.season).limit(1);
    const sid = (s?.[0] as { id: string } | undefined)?.id;
    if (!sid) return [];
    query = query.eq("season_id", sid);
  }
  const { data, error } = await query.order("starts_at", { ascending: !q.pastOnly }).limit(500);
  if (error) throw new Error(error.message);
  // Public: explicitly public, or following a public team (club-wide events need an explicit flag).
  const rows = ((data ?? []) as EventRow[]).filter((e) => e.is_public === true || (e.is_public === null && !!e.team_id && teamById.has(e.team_id)));
  const ids = rows.map((r) => r.id);
  const venueIds = Array.from(new Set(rows.map((r) => r.venue_id).filter((x): x is string => !!x)));
  const [{ data: results }, { data: venues }] = await Promise.all([
    ids.length ? db(c).from("game_results").select("event_id,score_for,score_against,outcome").eq("org_id", orgOf(c)).in("event_id", ids) : Promise.resolve({ data: [] }),
    venueIds.length ? db(c).from("venues").select("id,name,address,city,postal_code").eq("org_id", orgOf(c)).in("id", venueIds) : Promise.resolve({ data: [] }),
  ]);
  const resById = new Map(((results ?? []) as { event_id: string; score_for: number; score_against: number; outcome: string }[]).map((r) => [r.event_id, r]));
  const venueById = new Map(((venues ?? []) as VenueRow[]).map((v) => [v.id, v]));
  const out = rows.map((e) => {
    const team = e.team_id ? teamById.get(e.team_id) ?? null : null;
    const venue = e.venue_id ? venueById.get(e.venue_id) ?? null : null;
    const r = resById.get(e.id);
    const past = Date.parse(e.ends_at) < now.getTime();
    const type = TYPE_OUT[e.type] ?? "event";
    return {
      id: e.id, type,
      title: e.title ?? (e.opponent ? c.t("website.events.vs", { team: team?.name ?? c.club.tenant.name, opponent: e.opponent }) : team?.name ?? c.t.dynamic(`website.events.types.${type}`, {}, type)),
      team: team ? { slug: team.slug ?? team.id, name: team.name } : null,
      opponent: e.opponent, home_away: e.home_away,
      starts_at: e.starts_at, ends_at: e.ends_at,
      starts_at_formatted: c.f.dateTime(e.starts_at), time_formatted: `${c.f.time(e.starts_at)}–${c.f.time(e.ends_at)}`,
      venue: venue || e.location_text ? {
        name: venue?.name ?? e.location_text, address: venue ? [venue.address, [venue.postal_code, venue.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null : null,
        maps_url: mapsUrl(venue, e.location_text),
      } : null,
      status: STATUS_OUT[e.status] ?? "scheduled",
      result: past && r ? { our_score: r.score_for, their_score: r.score_against, outcome: r.outcome } : null,
      url: link(c, `/club/schedule${team ? `?team=${encodeURIComponent(team.slug ?? team.id)}` : ""}`),
    };
  });
  if (q.pastOnly) return out.filter((e) => e.result !== null);
  if (!q.type?.length || q.type.includes("event")) {
    // Club-wide calendar entries the club marked public (tournaments, socials, trips).
    const { data: ce } = await db(c).from("club_events").select("id,title,type,starts_at,ends_at,all_day,location,url,venue_id")
      .eq("org_id", orgOf(c)).eq("is_public", true).eq("audience", "everyone").gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString()).limit(200);
    if (!teamFilter) {
      for (const e of (ce ?? []) as { id: string; title: string; type: string; starts_at: string; ends_at: string; all_day: boolean; location: string | null; url: string | null }[]) {
        out.push({
          id: e.id, type: e.type === "tournament" ? "tournament" : "event", title: e.title, team: null, opponent: null, home_away: null,
          starts_at: e.starts_at, ends_at: e.ends_at, starts_at_formatted: e.all_day ? c.f.date(e.starts_at) : c.f.dateTime(e.starts_at),
          time_formatted: e.all_day ? c.t("website.events.allDay") : `${c.f.time(e.starts_at)}–${c.f.time(e.ends_at)}`,
          venue: e.location ? { name: e.location, address: null, maps_url: mapsUrl(null, e.location) } : null,
          status: "scheduled", result: null, url: e.url ?? link(c, "/club/schedule"),
        });
      }
      out.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// teams / coaches
// ---------------------------------------------------------------------------
type CoachRow = { id: string; display_name: string; role_title: string | null; bio: string | null; photo_path: string | null; photo_public: boolean; serves: string[] | null };

async function coachPhotos(c: Ctx, rows: CoachRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const want = rows.filter((r) => r.photo_public && r.photo_path && r.photo_path.startsWith(`${orgOf(c)}/${r.id}/`));
  if (!want.length) return out;
  try {
    const { data } = await db(c).storage.from("coach-photos").createSignedUrls(want.map((r) => r.photo_path!), 60 * 60 * 24);
    for (const [i, s] of (data ?? []).entries()) if (s?.signedUrl) out.set(want[i]!.id, s.signedUrl);
  } catch (e) {
    logError("website.coachPhotos", e);
  }
  return out;
}

async function publicCoaches(c: Ctx): Promise<CoachRow[]> {
  const { data } = await db(c).from("coaches").select("id,display_name,role_title,bio,photo_path,photo_public,serves")
    .eq("org_id", orgOf(c)).eq("is_active", true).eq("is_public", true).order("display_name");
  return (data ?? []) as CoachRow[];
}

export async function buildTeams(c: Ctx) {
  const teams = await publicTeams(c);
  if (!teams.length) return [];
  const ids = teams.map((t) => t.id);
  const now = c.now ?? new Date();
  const [{ data: tc }, coaches, { data: trainings }] = await Promise.all([
    db(c).from("team_coaches").select("team_id,coach_id,role").eq("org_id", orgOf(c)).in("team_id", ids),
    publicCoaches(c),
    db(c).from("events").select("team_id,starts_at,ends_at,venue_id,location_text").eq("org_id", orgOf(c)).in("team_id", ids).eq("type", "training")
      .in("status", ["scheduled"]).gte("starts_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + 28 * 864e5).toISOString()).limit(1000),
  ]);
  const coachById = new Map(coaches.map((k) => [k.id, k]));
  const photos = await coachPhotos(c, coaches);
  const venueIds = Array.from(new Set(((trainings ?? []) as { venue_id: string | null }[]).map((r) => r.venue_id).filter((x): x is string => !!x)));
  const { data: venues } = venueIds.length ? await db(c).from("venues").select("id,name").eq("org_id", orgOf(c)).in("id", venueIds) : { data: [] };
  const venueName = new Map(((venues ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
  const tz = c.f.timeZone;
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const roster = new Map<string, PublicRosterEntry[]>();
  if (c.club.settings.rosterPublic) {
    for (const t of teams.filter((x) => x.roster_public)) {
      const { data } = await db(c).rpc("website_public_roster", { p_org: orgOf(c), p_team: t.id });
      roster.set(t.id, sanitizeRosterRows((data ?? []) as { display_name: string | null; jersey_number: number | null }[]));
    }
  }
  return teams.map((t) => {
    const slots = new Map<string, { weekday: number; weekday_label: string; start: string; end: string; venue: string | null }>();
    for (const e of ((trainings ?? []) as { team_id: string; starts_at: string; ends_at: string; venue_id: string | null; location_text: string | null }[]).filter((x) => x.team_id === t.id)) {
      const d = new Date(e.starts_at);
      const weekday = WD[wd.format(d)] ?? 1;
      const start = hm.format(d);
      const end = hm.format(new Date(e.ends_at));
      const venue = e.venue_id ? venueName.get(e.venue_id) ?? null : e.location_text;
      const key = `${weekday}|${start}|${end}|${venue ?? ""}`;
      if (!slots.has(key)) {
        const label = new Intl.DateTimeFormat(c.f.locale, { timeZone: tz, weekday: "long" }).format(d);
        slots.set(key, { weekday, weekday_label: label, start, end, venue });
      }
    }
    const coachList = ((tc ?? []) as { team_id: string; coach_id: string; role: string }[])
      .filter((x) => x.team_id === t.id && coachById.has(x.coach_id))
      .map((x) => ({ name: coachById.get(x.coach_id)!.display_name, role: x.role, role_label: c.t.dynamic(`website.coachRoles.${x.role}`, {}, x.role), photo_url: photos.get(x.coach_id) ?? null }));
    const item: Record<string, unknown> = {
      slug: t.slug ?? t.id, name: t.name, age_group: t.age_group, league: t.league ?? t.level,
      coaches: coachList,
      training_times: Array.from(slots.values()).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)),
      cover_url: t.cover_public && t.cover_path && isLibraryPath(t.cover_path, orgOf(c)) ? clubMediaPublicUrl(t.cover_path) : null,
      url: link(c, `/club/schedule?team=${encodeURIComponent(t.slug ?? t.id)}`),
    };
    if (roster.has(t.id)) item.roster = roster.get(t.id);
    return item;
  });
}

export async function buildCoaches(c: Ctx) {
  const rows = await publicCoaches(c);
  if (!rows.length) return [];
  const [photos, { data: certs }] = await Promise.all([
    coachPhotos(c, rows),
    db(c).from("staff_certificates").select("coach_id,title,kind,valid_until,status").eq("org_id", orgOf(c)).in("coach_id", rows.map((r) => r.id))
      .eq("kind", "coaching_licence").eq("status", "verified"),
  ]);
  const today = (c.now ?? new Date()).toISOString().slice(0, 10);
  return rows.map((r) => ({
    id: r.id, name: r.display_name, role: r.role_title, bio: r.bio ? htmlToText(r.bio, 1500) : null,
    photo_url: photos.get(r.id) ?? null,
    licences: ((certs ?? []) as { coach_id: string; title: string | null; valid_until: string | null }[])
      .filter((x) => x.coach_id === r.id && x.title && (!x.valid_until || x.valid_until >= today)).map((x) => x.title!),
    url: (r.serves ?? []).length ? link(c, `/book/${c.club.tenant.slug}`) : link(c, "/club"),
  }));
}

// ---------------------------------------------------------------------------
// training (personal training services)
// ---------------------------------------------------------------------------
export async function buildTraining(c: Ctx) {
  const cat = await getPublicCatalog(c.club.tenant.slug);
  if (!cat || cat.org.id !== orgOf(c)) return [];
  const url = link(c, `/book/${c.club.tenant.slug}`);
  return cat.services.map((s) => ({
    id: s.id, name: s.name, description: s.description ? htmlToText(s.description, 1500) : null, duration: s.durationMin,
    group: { min: s.minParticipants, max: s.maxParticipants },
    price: money(c, s.price, s.currency),
    packages: s.packages.map((p) => ({ id: p.id, name: p.name, sessions: p.sessions, price: money(c, p.price, s.currency) })),
    url, action_url: url,
  }));
}

// ---------------------------------------------------------------------------
// shop
// ---------------------------------------------------------------------------
export async function buildShop(c: Ctx, q: { category?: string | null }) {
  const products = (await getStorefront(orgOf(c), false)).filter((p) => !q.category || (p.category ?? "").toLowerCase() === q.category.toLowerCase());
  return products.map((p) => ({
    id: p.id, name: p.name, description: p.description ? htmlToText(p.description, 2000) : null, category: p.category,
    images: p.images.map((i) => i.url),
    price: money(c, p.price, p.currency), member_price: null,
    in_stock: p.totalStock > 0,
    variants: p.variants.map((v) => ({ id: v.id, label: v.label, size: v.size, color: v.color, price: money(c, v.price, p.currency), in_stock: v.stock > 0 })),
    url: link(c, "/shop"), action_url: link(c, `/shop?product=${encodeURIComponent(p.id)}`),
  }));
}

// ---------------------------------------------------------------------------
// campaigns
// ---------------------------------------------------------------------------
export async function buildCampaigns(c: Ctx) {
  const { data } = await db(c).from("fundraising_campaigns").select("id,slug,title,description,goal_amount,currency,status,starts_on,ends_on")
    .eq("org_id", orgOf(c)).eq("is_public", true).eq("status", "active").order("created_at", { ascending: false }).limit(50);
  const rows = (data ?? []) as { id: string; slug: string; title: string; description: string | null; goal_amount: number | string; currency: string; status: string; starts_on: string | null; ends_on: string | null }[];
  if (!rows.length) return [];
  const { data: gifts } = await db(c).from("donations").select("campaign_id,amount,currency,status,donated_on")
    .eq("org_id", orgOf(c)).in("campaign_id", rows.map((r) => r.id)).eq("status", "received").limit(10000);
  const today = zonedDayKey(c.now ?? new Date(), c.f.timeZone);
  return rows.filter((r) => campaignOpen({ status: r.status, startsOn: r.starts_on, endsOn: r.ends_on }, today)).map((r) => {
    // Totals only: donor identities never leave the app.
    const mine = ((gifts ?? []) as { campaign_id: string; amount: number | string; currency: string; status: string; donated_on: string }[])
      .filter((g) => g.campaign_id === r.id)
      .map((g) => ({ amount: Number(g.amount), currency: g.currency, status: "received" as const, donorId: null, donatedOn: g.donated_on }));
    const p = campaignProgress(Number(r.goal_amount), r.currency, mine);
    return {
      slug: r.slug, title: r.title, description: r.description ? htmlToText(r.description, 1500) : null,
      goal: money(c, p.goal, r.currency), raised: money(c, p.raised, r.currency), progress_pct: p.barPercent,
      url: link(c, `/club/donate/${encodeURIComponent(r.slug)}`),
    };
  });
}

// ---------------------------------------------------------------------------
// news
// ---------------------------------------------------------------------------
export async function buildNews(c: Ctx, q: { limit?: number }) {
  const now = (c.now ?? new Date()).toISOString();
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 50);
  const [{ data: news }, { data: alerts }] = await Promise.all([
    db(c).from("website_news").select("id,title,excerpt,body_html,link_url,published_at")
      .eq("org_id", orgOf(c)).eq("is_public", true).lte("published_at", now).order("published_at", { ascending: false }).limit(limit),
    db(c).from("club_alerts").select("id,title,body,starts_at,expires_at,cancelled_at,audience")
      .eq("org_id", orgOf(c)).eq("is_public", true).eq("audience", "all").is("cancelled_at", null).lte("starts_at", now)
      .order("starts_at", { ascending: false }).limit(limit),
  ]);
  const items = [
    ...((news ?? []) as { id: string; title: string; excerpt: string | null; body_html: string | null; link_url: string | null; published_at: string }[]).map((n) => ({
      id: n.id, title: n.title, excerpt: n.excerpt ?? (n.body_html ? htmlToText(n.body_html, 300) : null),
      published_at: n.published_at, published_at_formatted: c.f.date(n.published_at),
      url: n.link_url ?? link(c, `/club/news/${n.id}`),
    })),
    ...((alerts ?? []) as { id: string; title: string; body: string | null; starts_at: string; expires_at: string | null }[])
      .filter((a) => !a.expires_at || a.expires_at > now)
      .map((a) => ({
        id: a.id, title: a.title, excerpt: a.body ? htmlToText(a.body, 300) : null,
        published_at: a.starts_at, published_at_formatted: c.f.date(a.starts_at), url: link(c, `/club/news/${a.id}`),
      })),
  ];
  return items.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).slice(0, limit);
}

/** One public news item (app page /club/news/[id]); null unless public and published. */
export async function getPublicNewsItem(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const d = websiteDb();
  const now = new Date().toISOString();
  const { data: n } = await d.from("website_news").select("id,title,excerpt,body_html,link_url,published_at")
    .eq("org_id", orgId).eq("id", id).eq("is_public", true).lte("published_at", now).maybeSingle();
  if (n) {
    const r = n as { id: string; title: string; excerpt: string | null; body_html: string | null; link_url: string | null; published_at: string };
    return { id: r.id, title: r.title, html: r.body_html ? sanitizeHtml(r.body_html) : textHtml(r.excerpt) ?? "", publishedAt: r.published_at, linkUrl: r.link_url };
  }
  const { data: a } = await d.from("club_alerts").select("id,title,body,starts_at,expires_at")
    .eq("org_id", orgId).eq("id", id).eq("is_public", true).eq("audience", "all").is("cancelled_at", null).lte("starts_at", now).maybeSingle();
  if (!a) return null;
  const r = a as { id: string; title: string; body: string | null; starts_at: string; expires_at: string | null };
  if (r.expires_at && r.expires_at <= now) return null;
  return { id: r.id, title: r.title, html: textHtml(r.body) ?? "", publishedAt: r.starts_at, linkUrl: null };
}

// ---------------------------------------------------------------------------
// placements (alumni showcase)
// ---------------------------------------------------------------------------
type ShowcaseRow = {
  id: string; display_name: string; institution: string; institution_type: string; level: string | null; league: string | null;
  country: string | null; sport: string | null; start_year: number | null; end_year: number | null; status: string;
};

/**
 * "Our placements": former players with PUBLIC-SHOWCASE CONSENT only (adults,
 * or minors with recorded guardian consent), first name + last initial or the
 * full name as consented, institution, type / level and year. No photos,
 * contact details or birth data. alumni_public_showcase() in SQL applies the
 * consent rules and the club's "placements" section switch; the module must
 * be on (alumni_network).
 */
export async function buildPlacements(c: Ctx, q: { limit?: number | null; type?: string | null } = {}) {
  const orgId = orgOf(c);
  if (!(await hasFeature(orgId, "alumni_network"))) return [];
  const { data, error } = await db(c).rpc("alumni_public_showcase", { p_org: orgId, p_limit: Math.min(Math.max(q.limit ?? 24, 1), 100) });
  if (error) {
    logError("website.placements", error);
    return [];
  }
  return ((data ?? []) as ShowcaseRow[])
    .filter((r) => !q.type || r.institution_type === q.type)
    .map((r) => ({
      id: r.id, name: r.display_name, institution: r.institution, type: r.institution_type,
      type_label: c.t.dynamic(`alumni.types.${r.institution_type}`, undefined, r.institution_type),
      level: r.level, league: r.league, country: r.country, sport: r.sport,
      year: r.start_year ?? r.end_year ?? null, class_of: r.end_year,
      status: r.status, status_label: c.t.dynamic(`alumni.placementStatuses.${r.status}`, undefined, r.status),
    }));
}

import "server-only";
import { unstable_cache } from "next/cache";
import type { Tenant } from "@/lib/tenant/types";
import { logError } from "@/lib/log";
import { getWebsiteSettings, websiteDb } from "@/lib/website/server";
import type { PublicSection } from "@/lib/website/settings-shape";
import {
  buildCampaigns, buildCamps, buildCoaches, buildNews, buildPlacements, buildPrograms, buildShop, buildTeams, buildTraining, loadPublicEvents, type Ctx,
} from "@/lib/website/public-data";
import type { BlockOf, LiveSource } from "./blocks";
import { listPublicPosts, siteI18n, siteLiveTag, siteTag, SITE_REVALIDATE_SECONDS, libraryUrl } from "./server";
import { postPath } from "./paths";

/**
 * Live blocks: app data rendered on the club site through the public data
 * layer (src/lib/website/public-data.ts) — published / public rows of THIS
 * club only, no personal data of members (no athletes or families; coaches
 * only when the club made them public; rosters only with media consent).
 * The club's public-section switches (Admin -> Website) are respected.
 *
 * Cached per club + language + block settings, tagged site-live:<org>: every
 * server action that changes programmes, camps, events, the shop, news or
 * campaigns calls notifyWebsite(), which revalidates the tag, so the site
 * updates on the next request (and at the latest after 5 minutes).
 */

const SECTION: Record<LiveSource, PublicSection | null> = {
  camps: "camps", programs: "programs", schedule: "events", results: "results", teams: "teams", team: "teams", coaches: "coaches",
  training: "training", shop: "shop", campaigns: "campaigns", news: "news", calendar: "events", placements: "placements",
};

type Awaited2<T> = T extends Promise<infer U> ? U : T;
export type LiveData =
  | { source: "camps"; items: Awaited2<ReturnType<typeof buildCamps>> }
  | { source: "programs"; items: Awaited2<ReturnType<typeof buildPrograms>> }
  | { source: "schedule" | "results"; items: Awaited2<ReturnType<typeof loadPublicEvents>> }
  | { source: "teams" | "team"; items: Record<string, unknown>[] }
  | { source: "coaches"; items: Awaited2<ReturnType<typeof buildCoaches>> }
  | { source: "training"; items: Awaited2<ReturnType<typeof buildTraining>> }
  | { source: "shop"; items: Awaited2<ReturnType<typeof buildShop>> }
  | { source: "campaigns"; items: Awaited2<ReturnType<typeof buildCampaigns>> }
  | { source: "news"; items: NewsCard[] }
  | { source: "calendar"; items: { icsUrl: string; webcalUrl: string }[] }
  | { source: "placements"; items: Awaited2<ReturnType<typeof buildPlacements>> };

export type NewsCard = { id: string; title: string; excerpt: string | null; date: string; dateFormatted: string; url: string; imageUrl: string | null; internal: boolean };

const SEASONS = new Set(["spring", "summer", "fall", "autumn", "winter", "other"]);

export async function loadLiveBlock(
  block: BlockOf<"live">,
  site: { orgId: string; tenant: Tenant & { id: string }; origin: string; defaultLanguage: string },
  lang: string,
): Promise<LiveData | null> {
  const key = ["site-live", site.orgId, lang, block.source, block.filter ?? "", String(block.limit)];
  try {
    return await unstable_cache(() => compute(block, site, lang), key, {
      tags: [siteLiveTag(site.orgId), siteTag(site.orgId)],
      revalidate: SITE_REVALIDATE_SECONDS,
    })();
  } catch (e) {
    logError("site.live", e, { source: block.source });
    return null;
  }
}

async function compute(
  block: BlockOf<"live">,
  site: { orgId: string; tenant: Tenant & { id: string }; origin: string; defaultLanguage: string },
  lang: string,
): Promise<LiveData | null> {
  const settings = await getWebsiteSettings(site.orgId);
  const section = SECTION[block.source];
  if (section && !settings.sections[section]) return null;
  const { t, f } = siteI18n(lang, site.tenant, site.defaultLanguage);
  // Links point at the club's own host (same origin as the site).
  const ctx: Ctx = { club: { tenant: site.tenant, settings }, t, f, appUrl: site.origin };
  const limit = block.limit;
  const filter = block.filter?.trim().toLowerCase() || null;
  switch (block.source) {
    case "camps": {
      const season = filter && SEASONS.has(filter) ? (filter === "autumn" ? "fall" : filter) : null;
      return { source: "camps", items: (await buildCamps(ctx, { season })).slice(0, limit) };
    }
    case "programs": {
      const kind = filter && ["team", "camp", "clinic", "tournament"].includes(filter) ? [filter] : undefined;
      return { source: "programs", items: (await buildPrograms(ctx, { kind })).slice(0, limit) };
    }
    case "schedule":
      return { source: "schedule", items: (await loadPublicEvents(ctx, { team: filter })).slice(0, limit) };
    case "results":
      return { source: "results", items: (await loadPublicEvents(ctx, { team: filter, pastOnly: true })).slice(0, limit) };
    case "teams":
      return { source: "teams", items: (await buildTeams(ctx)).slice(0, limit) };
    case "team":
      return { source: "team", items: (await buildTeams(ctx)).filter((x) => !filter || x.slug === filter).slice(0, 1) };
    case "coaches":
      return { source: "coaches", items: (await buildCoaches(ctx)).slice(0, limit) };
    case "training":
      return { source: "training", items: (await buildTraining(ctx)).slice(0, limit) };
    case "shop":
      return { source: "shop", items: (await buildShop(ctx, { category: filter })).slice(0, limit) };
    case "campaigns":
      return { source: "campaigns", items: (await buildCampaigns(ctx)).slice(0, limit) };
    case "news": {
      const [posts, app] = await Promise.all([listPublicPosts(site.orgId, limit, 0, filter), filter ? Promise.resolve([]) : buildNews(ctx, { limit })]);
      const prefix = lang.toLowerCase() === site.defaultLanguage.toLowerCase() ? "" : `/${lang.toLowerCase()}`;
      const cards: NewsCard[] = [
        ...posts
          .map((p): NewsCard | null => {
            const tr = p.content[lang] ?? p.content[site.defaultLanguage] ?? Object.values(p.content)[0];
            if (!tr || tr.state === "needs_translation") return null;
            return {
              id: p.id, title: tr.title, excerpt: tr.excerpt ?? null, date: p.publishedAt, dateFormatted: f.date(p.publishedAt, { style: "long" }),
              url: `${prefix}${postPath(p.slug)}`, imageUrl: libraryUrl(site.orgId, p.coverPath), internal: true,
            };
          })
          .filter((x): x is NewsCard => !!x),
        ...app.map((n) => ({ id: n.id, title: n.title, excerpt: n.excerpt, date: n.published_at, dateFormatted: f.date(n.published_at, { style: "long" }), url: n.url, imageUrl: null, internal: false })),
      ];
      return { source: "news", items: cards.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, limit) };
    }
    case "placements":
      return { source: "placements", items: await buildPlacements(ctx, { limit, type: filter }) };
    case "calendar": {
      const ics = `${site.origin.replace(/\/+$/, "")}/api/site/calendar`;
      return { source: "calendar", items: [{ icsUrl: ics, webcalUrl: ics.replace(/^https?:/, "webcal:") }] };
    }
  }
}

/**
 * Sponsor names for a logos block: ACTIVE sponsors of the club that are a
 * company / organisation (never a private person) and have a "website"
 * deliverable in the operations module, i.e. the club owes them website
 * visibility. Names only (logos are added by the admin in the block).
 */
export async function loadSponsorNames(orgId: string): Promise<{ name: string; tier: string }[]> {
  try {
    return await unstable_cache(
      async () => {
        const db = websiteDb();
        const { data: del } = await db.from("sponsor_deliverables").select("sponsor_id").eq("org_id", orgId).eq("kind", "website").limit(500);
        const ids = Array.from(new Set(((del ?? []) as { sponsor_id: string }[]).map((d) => d.sponsor_id)));
        if (!ids.length) return [];
        const { data: sp } = await db.from("sponsors").select("id,customer_id,tier,status").eq("org_id", orgId).eq("status", "active").in("id", ids);
        const rows = (sp ?? []) as { customer_id: string; tier: string }[];
        if (!rows.length) return [];
        const { data: cu } = await db.from("ops_customers").select("id,name,kind").eq("org_id", orgId).in("id", rows.map((r) => r.customer_id)).neq("kind", "person");
        const names = new Map(((cu ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
        const order = ["platinum", "gold", "silver", "bronze", "partner", "supplier"];
        return rows
          .filter((r) => names.has(r.customer_id))
          .map((r) => ({ name: names.get(r.customer_id)!, tier: r.tier }))
          .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || a.name.localeCompare(b.name));
      },
      ["site-sponsors", orgId],
      { tags: [siteLiveTag(orgId), siteTag(orgId)], revalidate: SITE_REVALIDATE_SECONDS },
    )();
  } catch (e) {
    logError("site.sponsors", e);
    return [];
  }
}

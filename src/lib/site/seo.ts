import { localizedPath } from "./paths";

/**
 * SEO builders for the club site (pure): hreflang alternates, sitemap.xml,
 * robots.txt and JSON-LD (SportsOrganization, SportsEvent, BreadcrumbList,
 * NewsArticle). Origins are always the club's own host, resolved server-side.
 */

export type Alternate = { hreflang: string; href: string };

/**
 * hreflang alternates of a page: one per language that has a published
 * translation, plus x-default (the default language, or the first available).
 */
export function hreflangAlternates(origin: string, path: string, languages: readonly string[], defaultLang: string): Alternate[] {
  const base = origin.replace(/\/+$/, "");
  const langs = Array.from(new Set(languages));
  if (!langs.length) return [];
  const out = langs.map((l) => ({ hreflang: l, href: `${base}${localizedPath(path, l, defaultLang)}` }));
  const xDefault = langs.includes(defaultLang) ? defaultLang : langs[0]!;
  out.push({ hreflang: "x-default", href: `${base}${localizedPath(path, xDefault, defaultLang)}` });
  return out;
}

/** Next.js metadata.alternates.languages shape. */
export function alternatesToMetadata(alts: readonly Alternate[]): Record<string, string> {
  return Object.fromEntries(alts.map((a) => [a.hreflang, a.href]));
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export type SitemapEntry = { path: string; languages: readonly string[]; lastmod?: string | null };

/** sitemap.xml with xhtml:link alternates for every translation. */
export function buildSitemap(origin: string, entries: readonly SitemapEntry[], defaultLang: string): string {
  const base = origin.replace(/\/+$/, "");
  const urls: string[] = [];
  for (const e of entries) {
    const alts = hreflangAlternates(base, e.path, e.languages, defaultLang);
    for (const l of e.languages) {
      const loc = `${base}${localizedPath(e.path, l, defaultLang)}`;
      const links = alts.length > 2 ? alts.map((a) => `    <xhtml:link rel="alternate" hreflang="${xml(a.hreflang)}" href="${xml(a.href)}"/>`).join("\n") : "";
      const lastmod = e.lastmod && !Number.isNaN(Date.parse(e.lastmod)) ? `\n    <lastmod>${new Date(e.lastmod).toISOString()}</lastmod>` : "";
      urls.push(`  <url>\n    <loc>${xml(loc)}</loc>${lastmod}${links ? `\n${links}` : ""}\n  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

/** robots.txt: the public site is crawlable; the app's private areas are not. */
export function buildRobots(origin: string | null, siteLive: boolean): string {
  const lines = ["User-agent: *"];
  if (siteLive) {
    lines.push("Allow: /");
    for (const p of ["/admin", "/coach", "/parent", "/platform", "/api/", "/auth", "/onboarding", "/board", "/scout", "/waitlist", "/embed"]) lines.push(`Disallow: ${p}`);
    if (origin) lines.push("", `Sitemap: ${origin.replace(/\/+$/, "")}/sitemap.xml`);
  } else {
    for (const p of ["/admin", "/coach", "/parent", "/platform", "/api/", "/auth", "/onboarding", "/board", "/scout", "/waitlist"]) lines.push(`Disallow: ${p}`);
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

export type OrgLd = { name: string; url: string; logo?: string | null; sport?: string | null; email?: string | null; sameAs?: string[]; address?: string | null };

export function sportsOrganizationLd(o: OrgLd): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: o.name,
    url: o.url,
    ...(o.logo ? { logo: o.logo } : {}),
    ...(o.sport ? { sport: o.sport } : {}),
    ...(o.email ? { email: o.email } : {}),
    ...(o.address ? { address: o.address } : {}),
    ...(o.sameAs && o.sameAs.length ? { sameAs: o.sameAs } : {}),
  };
}

export type EventLd = {
  name: string;
  startDate: string;
  endDate?: string | null;
  url?: string | null;
  location?: string | null;
  image?: string | null;
  organizer: string;
  offer?: { price: number; currency: string; url?: string | null; available: boolean } | null;
  cancelled?: boolean;
};

export function sportsEventLd(e: EventLd): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: e.name,
    startDate: e.startDate,
    ...(e.endDate ? { endDate: e.endDate } : {}),
    eventStatus: e.cancelled ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(e.location ? { location: { "@type": "Place", name: e.location, address: e.location } } : {}),
    ...(e.image ? { image: [e.image] } : {}),
    ...(e.url ? { url: e.url } : {}),
    organizer: { "@type": "SportsOrganization", name: e.organizer },
    ...(e.offer
      ? {
          offers: {
            "@type": "Offer",
            price: e.offer.price,
            priceCurrency: e.offer.currency,
            availability: e.offer.available ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
            ...(e.offer.url ? { url: e.offer.url } : {}),
          },
        }
      : {}),
  };
}

export function breadcrumbLd(items: readonly { name: string; url: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

export function newsArticleLd(a: { headline: string; url: string; datePublished: string; dateModified?: string | null; image?: string | null; author?: string | null; publisher: string }): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.headline.slice(0, 110),
    url: a.url,
    datePublished: a.datePublished,
    ...(a.dateModified ? { dateModified: a.dateModified } : {}),
    ...(a.image ? { image: [a.image] } : {}),
    ...(a.author ? { author: { "@type": "Person", name: a.author } } : {}),
    publisher: { "@type": "Organization", name: a.publisher },
  };
}

/** Serialise JSON-LD for a <script> tag (no "</script>" break-out). */
export function jsonLdString(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Breadcrumb trail from a path: "/camps/summer" -> ["/", "/camps", "/camps/summer"]. */
export function pathTrail(path: string): string[] {
  if (path === "/") return ["/"];
  const segs = path.slice(1).split("/");
  return ["/", ...segs.map((_, i) => `/${segs.slice(0, i + 1).join("/")}`)];
}

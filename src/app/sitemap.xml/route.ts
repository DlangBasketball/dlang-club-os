import { getRequestSite, listPublicPosts } from "@/lib/site/server";
import { buildSitemap, type SitemapEntry } from "@/lib/site/seo";
import { pageLanguages } from "@/lib/site/nav";
import { postPath } from "@/lib/site/paths";

/**
 * sitemap.xml of the club site on its own host (published pages and news
 * posts, every published translation with hreflang alternates). 404 on hosts
 * without an enabled site.
 */
export async function GET(): Promise<Response> {
  const site = await getRequestSite();
  if (!site || site.settings.seo.noindex) return new Response("Not found", { status: 404 });
  const def = site.settings.defaultLanguage;
  const entries: SitemapEntry[] = site.pages.map((p) => ({ path: p.path, languages: pageLanguages(p.titles, site.settings.languages, def), lastmod: p.updatedAt }));
  const posts = await listPublicPosts(site.orgId, 500, 0, null);
  for (const p of posts) {
    const langs = site.settings.languages.filter((l) => p.content[l] && p.content[l]!.state !== "needs_translation");
    entries.push({ path: postPath(p.slug), languages: langs, lastmod: p.updatedAt });
  }
  const xml = buildSitemap(site.origin, entries.filter((e) => e.languages.length), def);
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
}

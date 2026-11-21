import { getRequestSite } from "@/lib/site/server";
import { buildRobots } from "@/lib/site/seo";

/** robots.txt per host: the club site is crawlable, the app's private areas are not. */
export async function GET(): Promise<Response> {
  const site = await getRequestSite();
  const live = !!site && !site.settings.seo.noindex;
  return new Response(buildRobots(live ? site!.origin : null, live), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" },
  });
}

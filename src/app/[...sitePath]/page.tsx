import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { isReservedPath } from "@/lib/site/paths";
import { resolveSiteRequest } from "@/lib/site/resolve";
import { SitePageView, SitePostView, siteMetadata } from "@/components/site/site-page";

/**
 * The club's public website at clean paths on its own host (/about-us,
 * /camps/summer-camps, /fr/contact, /news/<slug>). This catch-all only
 * receives paths no app route matched; reserved app paths (admin, login,
 * register, book, shop, club, embed, api, ...) are refused here as well, so
 * the site can never shadow the app. Hosts without an enabled site get 404.
 */

type Params = { sitePath?: string[] };

function pathFrom(segments: string[] | undefined): string {
  // Next decodes params; re-encode so imported percent-encoded slugs match.
  return `/${(segments ?? []).map((s) => encodeURIComponent(s)).join("/")}`;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const path = pathFrom((await params).sitePath);
  if (isReservedPath(path)) return {};
  const r = await resolveSiteRequest(path);
  if (!r) return {};
  if (r.kind === "page") {
    return siteMetadata({ site: r.site, lang: r.lang, path: r.path, languages: r.languages, title: r.tr.metaTitle || r.tr.title, description: r.tr.metaDescription, ogImagePath: r.tr.ogImage?.path ?? null });
  }
  if (r.kind === "post") {
    return siteMetadata({ site: r.site, lang: r.lang, path: r.path, languages: r.languages, title: r.tr.metaTitle || r.tr.title, description: r.tr.metaDescription || r.tr.excerpt, ogImagePath: r.post.coverPath, type: "article" });
  }
  return {};
}

export default async function SitePage({ params }: { params: Promise<Params> }) {
  const path = pathFrom((await params).sitePath);
  if (isReservedPath(path)) notFound();
  const r = await resolveSiteRequest(path);
  if (!r || r.kind === "notFound") notFound();
  if (r.kind === "redirect") {
    if (r.status === 301) permanentRedirect(r.to);
    redirect(r.to);
  }
  if (r.kind === "post") return <SitePostView site={r.site} lang={r.lang} post={r.post} tr={r.tr} languages={r.languages} />;
  return <SitePageView site={r.site} lang={r.lang} path={r.path} page={r.tr} languages={r.languages} />;
}

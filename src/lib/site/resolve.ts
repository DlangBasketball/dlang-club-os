import "server-only";
import { cache } from "react";
import type { PageLang, PostLang } from "./blocks";
import { textDir } from "./languages";
import { isReservedPath, localizedPath, normalizeRequestPath, postSlugOf, splitLangPath } from "./paths";
import { getPublicPage, getPublicPost, getRequestSite, getSiteRedirect, type PublicPage, type PublicPost, type ResolvedSite } from "./server";

/**
 * Resolve a request path on a club host to what the site serves:
 * a page, a news post, a redirect, or nothing (404). Reserved app paths are
 * never resolved (the app's own routes always win).
 */

export type SiteResolution =
  | { kind: "page"; site: ResolvedSite; lang: string; path: string; page: PublicPage; tr: PageLang; languages: string[] }
  | { kind: "post"; site: ResolvedSite; lang: string; path: string; post: PublicPost; tr: PostLang; languages: string[] }
  | { kind: "redirect"; to: string; status: 301 | 302 }
  | { kind: "notFound" };

function liveLanguages<T extends { state?: string; title?: string }>(content: Record<string, T>, siteLangs: readonly string[], def: string): string[] {
  const ok = siteLangs.filter((l) => content[l] && content[l]!.state !== "needs_translation" && (content[l]!.title ?? "").trim());
  return [...ok.filter((l) => l === def), ...ok.filter((l) => l !== def)];
}

export const resolveSiteRequest = cache(async (rawPath: string): Promise<SiteResolution | null> => {
  const normalized = normalizeRequestPath(rawPath);
  if (!normalized || isReservedPath(normalized)) return null;
  const site = await getRequestSite();
  if (!site) return null;
  const def = site.settings.defaultLanguage;
  const split = splitLangPath(normalized, site.settings.languages, def);
  if (!split || isReservedPath(split.path)) return { kind: "notFound" };
  if (split.redundantPrefix) return { kind: "redirect", to: localizedPath(split.path, def, def), status: 301 };
  const { lang, path } = split;

  const page = await getPublicPage(site.orgId, path);
  if (page) {
    const languages = liveLanguages(page.content, site.settings.languages, def);
    const tr = page.content[lang];
    if (!tr || !languages.includes(lang)) {
      const fallback = languages.includes(def) ? def : languages[0];
      if (!fallback) return { kind: "notFound" };
      return { kind: "redirect", to: localizedPath(path, fallback, def), status: 302 };
    }
    return { kind: "page", site, lang, path, page, tr, languages };
  }

  const slug = postSlugOf(path);
  if (slug) {
    const post = await getPublicPost(site.orgId, slug);
    if (post) {
      const languages = liveLanguages(post.content, site.settings.languages, def);
      const tr = post.content[lang];
      if (!tr || !languages.includes(lang)) {
        const fallback = languages.includes(def) ? def : languages[0];
        if (!fallback) return { kind: "notFound" };
        return { kind: "redirect", to: localizedPath(path, fallback, def), status: 302 };
      }
      return { kind: "post", site, lang, path, post, tr, languages };
    }
  }

  const redirect = (await getSiteRedirect(site.orgId, normalized)) ?? (normalized !== path ? await getSiteRedirect(site.orgId, path) : null);
  if (redirect && normalizeRequestPath(redirect.to) !== normalized) return { kind: "redirect", to: redirect.to, status: redirect.status };
  return { kind: "notFound" };
});

/** <html lang dir> for a site request (root layout); null when the path is not a site page. */
export async function siteDocumentLang(rawPath: string | null): Promise<{ lang: string; dir: "ltr" | "rtl" } | null> {
  if (!rawPath) return null;
  const normalized = normalizeRequestPath(rawPath);
  if (!normalized || isReservedPath(normalized)) return null;
  try {
    const site = await getRequestSite();
    if (!site) return null;
    const split = splitLangPath(normalized, site.settings.languages, site.settings.defaultLanguage);
    if (!split) return null;
    return { lang: split.lang, dir: textDir(split.lang) };
  } catch {
    return null;
  }
}

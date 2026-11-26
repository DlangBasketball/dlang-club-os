import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { imagePathsOf, type PageLang, type PostLang } from "@/lib/site/blocks";
import { nativeLanguageName, textDir } from "@/lib/site/languages";
import { localizedPath, postPath } from "@/lib/site/paths";
import { alternatesToMetadata, breadcrumbLd, hreflangAlternates, jsonLdString, newsArticleLd, pathTrail } from "@/lib/site/seo";
import { clearedImages, libraryUrl, previewImages, siteI18n, type PublicPost, type ResolvedSite } from "@/lib/site/server";
import { Blocks } from "./blocks";
import { SiteShell } from "./site-shell";
import { SiteImage } from "./site-image";
import type { RenderCtx, SiteImg } from "./types";

const WRAP = "mx-auto w-full max-w-[var(--site-max)] px-4 sm:px-6 lg:px-8";

async function imagesFor(site: ResolvedSite, paths: string[], preview: boolean): Promise<Map<string, SiteImg>> {
  if (preview) return previewImages(site.orgId, paths);
  const cleared = await clearedImages(site.orgId, paths);
  return new Map(Array.from(cleared.entries()).map(([k, v]) => [k, { ...v, cleared: true }]));
}

export async function makeCtx(site: ResolvedSite, lang: string, path: string, paths: string[], preview: boolean): Promise<RenderCtx> {
  const { t, f } = siteI18n(lang, site.tenant, site.settings.defaultLanguage);
  return { site, lang, defaultLang: site.settings.defaultLanguage, path, t, f, images: await imagesFor(site, paths, preview), preview };
}

/** A content page (published snapshot, or the working copy in the admin preview). */
export async function SitePageView({ site, lang, path, page, languages, preview = false, langHref, contentLang, switcher }: {
  site: ResolvedSite; lang: string; path: string; page: PageLang; languages: string[]; preview?: boolean; langHref?: (lang: string) => string;
  /** Language of `page` when it is a fallback (page not translated into `lang` yet). */
  contentLang?: string;
  /** Languages in the switcher (defaults to `languages`). */
  switcher?: string[];
}) {
  const ctx = await makeCtx(site, lang, path, imagePathsOf({ [lang]: page }), preview);
  const shownLang = contentLang ?? lang;
  const fallback = shownLang !== lang;
  const startsWithHero = page.blocks[0]?.type === "hero";
  const trail = pathTrail(path)
    .map((p) => ({ path: p, page: site.pages.find((x) => x.path === p) }))
    .filter((x) => x.page)
    .map((x) => ({ name: x.page!.titles[lang] ?? x.page!.titles[ctx.defaultLang] ?? site.tenant.name, url: `${site.origin}${localizedPath(x.path, lang, ctx.defaultLang)}` }));
  return (
    <SiteShell ctx={ctx} languages={(switcher ?? languages).map((l) => ({ tag: l, href: langHref ? langHref(l) : localizedPath(path, l, ctx.defaultLang) }))}>
      {preview && (
        <div className="bg-warning px-4 py-2 text-center text-sm font-semibold text-bg" role="status">
          {ctx.t("site.render.previewBanner")}
          {page.state === "machine_draft" ? ` · ${ctx.t("site.render.machineDraft")}` : ""}
        </div>
      )}
      {fallback && (
        <p role="note" className="border-b border-border-soft bg-bg-secondary px-4 py-2 text-center text-sm text-text-secondary">
          {ctx.t("site.render.notTranslated", { language: nativeLanguageName(lang), shown: nativeLanguageName(shownLang) })}
        </p>
      )}
      <div lang={fallback ? shownLang : undefined} dir={fallback ? textDir(shownLang) : undefined}>
        {!startsWithHero && (
          <section className={cn(WRAP, "pb-4 pt-16 sm:pt-24")}>
            <h1 className="site-h text-5xl text-text sm:text-6xl">{page.title}</h1>
          </section>
        )}
        <Blocks blocks={page.blocks} ctx={ctx} />
      </div>
      {trail.length > 1 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbLd(trail)) }} />}
    </SiteShell>
  );
}

/** One news post (/news/<slug>). */
export async function SitePostView({ site, lang, post, tr, languages }: { site: ResolvedSite; lang: string; post: PublicPost; tr: PostLang; languages: string[] }) {
  const path = postPath(post.slug);
  const ctx = await makeCtx(site, lang, path, post.coverPath ? [post.coverPath] : [], false);
  const cover = post.coverPath ? ctx.images.get(post.coverPath) ?? null : null;
  const url = `${site.origin}${localizedPath(path, lang, ctx.defaultLang)}`;
  return (
    <SiteShell ctx={ctx} languages={languages.map((l) => ({ tag: l, href: localizedPath(path, l, ctx.defaultLang) }))}>
      <article>
        <header className={cn("relative isolate overflow-hidden", cover ? "min-h-[56svh]" : "")}>
          {cover && (
            <>
              <div className="absolute inset-0 -z-20">
                <SiteImage img={{ ...cover, ref: { path: post.coverPath!, focalX: post.focalX, focalY: post.focalY } }} fill sizes="100vw" priority />
              </div>
              <div aria-hidden className="absolute inset-0 -z-10 site-scrim-gradient" />
            </>
          )}
          <div className={cn(WRAP, "max-w-4xl pb-12", cover ? "pt-48" : "pt-16 sm:pt-24")}>
            <p className={cn("flex items-center gap-2 text-sm", cover ? "site-on-photo" : "text-text-muted")}>
              <CalendarDays className="h-4 w-4" aria-hidden />
              <time dateTime={post.publishedAt}>{ctx.f.date(post.publishedAt, { style: "long" })}</time>
              {post.author && <span>· {post.author}</span>}
            </p>
            <h1 className={cn("site-h mt-4 text-4xl sm:text-6xl", cover ? "site-on-photo" : "text-text")}>{tr.title}</h1>
          </div>
        </header>
        <div className={cn(WRAP, "max-w-3xl py-12")}>
          {tr.excerpt && <p className="mb-8 text-xl text-text">{tr.excerpt}</p>}
          {/* bodyHtml is sanitised (sanitizeRichText) on save and on parse. */}
          <div className="site-prose" dangerouslySetInnerHTML={{ __html: tr.bodyHtml }} />
          {!!post.tags.length && (
            <ul className="mt-10 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <li key={tag} className="rounded-full bg-surface px-3 py-1 text-xs text-text-secondary">#{tag}</li>
              ))}
            </ul>
          )}
          <a href={localizedPath("/news", lang, ctx.defaultLang)} className="site-link mt-10 inline-block font-semibold">
            {ctx.t("site.render.allNews")}
          </a>
        </div>
      </article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(newsArticleLd({ headline: tr.title, url, datePublished: post.publishedAt, dateModified: post.updatedAt, image: cover?.url ?? null, author: post.author, publisher: site.tenant.name })) }}
      />
    </SiteShell>
  );
}

/** Per-page metadata: title, description, canonical, hreflang alternates, Open Graph. */
export function siteMetadata(opts: { site: ResolvedSite; lang: string; path: string; languages: string[]; title: string; description?: string | null; ogImagePath?: string | null; type?: "website" | "article"; isHome?: boolean }): Metadata {
  const { site, lang, path } = opts;
  const def = site.settings.defaultLanguage;
  const suffix = site.settings.seo.titleSuffix || site.tenant.name;
  const fullTitle = opts.isHome ? (opts.title === site.tenant.name ? site.tenant.name : `${site.tenant.name} · ${opts.title}`) : opts.title === suffix ? opts.title : `${opts.title} · ${suffix}`;
  const description = (opts.description || site.settings.seo.description?.[lang] || site.settings.seo.description?.[def] || "").slice(0, 300) || undefined;
  const alts = hreflangAlternates(site.origin, path, opts.languages, def);
  const canonical = `${site.origin.replace(/\/+$/, "")}${localizedPath(path, lang, def)}`;
  const og = libraryUrl(site.orgId, opts.ogImagePath ?? null) ?? libraryUrl(site.orgId, site.settings.seo.ogImagePath ?? null);
  const icon = libraryUrl(site.orgId, site.settings.faviconPath) ?? site.tenant.branding.faviconUrl ?? site.tenant.branding.logoUrl;
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical, languages: alternatesToMetadata(alts) },
    openGraph: {
      type: opts.type ?? "website",
      title: fullTitle,
      description,
      url: canonical,
      siteName: site.tenant.name,
      locale: lang.replace("-", "_"),
      alternateLocale: opts.languages.filter((l) => l !== lang).map((l) => l.replace("-", "_")),
      ...(og ? { images: [{ url: og }] } : {}),
    },
    twitter: { card: og ? "summary_large_image" : "summary", title: fullTitle, description, ...(og ? { images: [og] } : {}) },
    robots: site.settings.seo.noindex ? { index: false, follow: false } : undefined,
    ...(icon ? { icons: { icon } } : {}),
    other: { "content-language": lang },
  };
}

export { textDir };

import Link from "next/link";
import Script from "next/script";
import { ChevronDown } from "lucide-react";
import { ConsentGate, CookieSettingsButton } from "@/components/compliance/cookie-consent-banner";
import { cn } from "@/lib/utils";
import { textDir, nativeLanguageName } from "@/lib/site/languages";
import { buildNav } from "@/lib/site/nav";
import { localizedPath } from "@/lib/site/paths";
import { jsonLdString, sportsOrganizationLd } from "@/lib/site/seo";
import { siteCssVars, siteFontsHref, siteIsDark } from "@/lib/site/theme";
import { libraryUrl } from "@/lib/site/server";
import { LanguageMenu, MobileNav } from "./client";
import type { RenderCtx } from "./types";

const WRAP = "mx-auto w-full max-w-[var(--site-max)] px-4 sm:px-6 lg:px-8";

const SOCIAL_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", x: "X", linkedin: "LinkedIn" };

/**
 * Page chrome of the club site: themed wrapper (template + club palette as
 * CSS variables), header (logo, menu, language switcher, "My account",
 * "Get the app"), footer, organisation JSON-LD and consent-gated analytics.
 * Every string is translated for the page language (nearest app catalog).
 */
export function SiteShell({ ctx, languages, children }: { ctx: RenderCtx; languages: { tag: string; href: string }[]; children: React.ReactNode }) {
  const { site, lang, t } = ctx;
  const s = site.settings;
  const themeInput = { template: s.template, branding: site.tenant.branding, palette: s.palette, fonts: s.fonts };
  const vars = siteCssVars(themeInput) as React.CSSProperties;
  const fonts = siteFontsHref(themeInput);
  const dark = siteIsDark(themeInput);
  const logo = libraryUrl(site.orgId, s.logoPath) ?? site.tenant.branding.logoUrl;
  const nav = buildNav({ custom: s.headerNav, pages: site.pages, lang, defaultLang: ctx.defaultLang, currentPath: ctx.path });
  const home = localizedPath("/", lang, ctx.defaultLang);
  const extra = [
    { label: t("site.chrome.myAccount"), href: "/login" },
    { label: t("site.chrome.getApp"), href: "/club", primary: true },
  ];
  const langOptions = languages.map((l) => ({ tag: l.tag, name: nativeLanguageName(l.tag), href: l.href }));
  const year = new Date().getFullYear();
  const orgLd = sportsOrganizationLd({
    name: site.tenant.name, url: `${site.origin}${home === "/" ? "" : home}`, logo, sport: site.tenant.sport, email: s.contactEmail,
    sameAs: Object.values(s.social),
  });
  return (
    <div
      className={cn("site-root min-h-dvh", `site-template-${s.template}`)}
      style={{ ...vars, colorScheme: dark ? "dark" : "light" }}
      lang={lang}
      dir={textDir(lang)}
      data-site-template={s.template}
    >
      {fonts && <link rel="stylesheet" href={fonts} />}
      <a href="#site-main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-surface focus:px-4 focus:py-2">
        {t("site.chrome.skip")}
      </a>
      <header className="site-header-glass sticky top-0 z-40 border-b border-border-soft">
        <div className={cn(WRAP, "flex h-16 items-center gap-4 lg:h-20")}>
          <a href={home} className="flex min-w-0 items-center gap-3 focus-visible:shadow-focus" aria-label={t("site.chrome.home", { club: site.tenant.name })}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- club logo (any size / SVG), small
              <img src={logo} alt="" className="h-9 w-auto max-w-[9rem] object-contain lg:h-11" />
            ) : null}
            <span className="site-h truncate text-lg text-text lg:text-xl">{site.tenant.name}</span>
          </a>
          <nav aria-label={t("site.chrome.mainNav")} className="ms-auto hidden lg:block">
            <ul className="flex items-center gap-1">
              {nav.map((l) => (
                <li key={l.href} className="group relative">
                  <a href={l.href} aria-current={l.current ? "page" : undefined} className={cn("inline-flex min-h-tap items-center gap-1 rounded-full px-3 text-sm font-medium transition hover:text-brand-primary focus-visible:shadow-focus", l.current ? "text-brand-primary" : "text-text")}>
                    {l.label}
                    {!!l.children?.length && <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                  </a>
                  {!!l.children?.length && (
                    <ul className="invisible absolute start-0 top-full z-50 min-w-[14rem] translate-y-1 rounded-md border border-border bg-surface-elevated py-2 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                      {l.children.map((c) => (
                        <li key={c.href}>
                          <a href={c.href} aria-current={c.current ? "page" : undefined} className="block px-4 py-2 text-sm text-text hover:bg-surface hover:text-brand-primary">
                            {c.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
          <div className="ms-auto flex items-center gap-2 lg:ms-2">
            <LanguageMenu current={lang} options={langOptions} label={t("site.chrome.language")} />
            <Link href="/login" className="hidden min-h-tap items-center rounded-full px-3 text-sm font-medium text-text hover:text-brand-primary focus-visible:shadow-focus sm:inline-flex">
              {t("site.chrome.myAccount")}
            </Link>
            <Link href="/club" className="site-btn site-btn-primary hidden sm:inline-flex">
              {t("site.chrome.getApp")}
            </Link>
            <MobileNav links={nav} extra={extra} labels={{ open: t("site.chrome.openMenu"), close: t("site.chrome.closeMenu"), nav: t("site.chrome.mainNav") }} />
          </div>
        </div>
      </header>

      <main id="site-main">{children}</main>

      <footer className="mt-12 border-t border-border bg-bg-secondary">
        <div className={cn(WRAP, "grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4")}>
          <div>
            <p className="site-h text-2xl text-text">{site.tenant.name}</p>
            {s.seo.description?.[lang] && <p className="mt-3 text-sm text-text-secondary">{s.seo.description[lang]}</p>}
          </div>
          {!!nav.length && (
            <nav aria-label={t("site.chrome.footerNav")}>
              <p className="site-eyebrow">{t("site.chrome.explore")}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {nav.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="text-text-secondary hover:text-brand-primary">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          {s.footerColumns.slice(0, 2).map((col, i) => (
            <div key={i}>
              <p className="site-eyebrow">{col.title?.[lang] ?? col.title?.[ctx.defaultLang] ?? ""}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {(col.links ?? []).slice(0, 12).map((l, k) => (
                  <li key={k}>
                    <a href={l.href} className="text-text-secondary hover:text-brand-primary">
                      {l.label?.[lang] ?? l.label?.[ctx.defaultLang] ?? l.href}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <p className="site-eyebrow">{t("site.chrome.contact")}</p>
            <ul className="mt-4 space-y-2 text-sm text-text-secondary">
              {s.contactEmail && (
                <li>
                  <a href={`mailto:${s.contactEmail}`} className="hover:text-brand-primary">
                    {s.contactEmail}
                  </a>
                </li>
              )}
              {Object.entries(s.social).map(([k, url]) => (
                <li key={k}>
                  <a href={url} target="_blank" rel="noopener noreferrer me" className="hover:text-brand-primary">
                    {SOCIAL_LABEL[k] ?? k}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/login" className="hover:text-brand-primary">
                  {t("site.chrome.myAccount")}
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border-soft">
          <div className={cn(WRAP, "flex flex-col gap-3 py-6 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between")}>
            <p>{t("site.chrome.copyright", { year, club: site.tenant.name })}</p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              <li><a href={`/legal/${site.tenant.slug}/privacy`} className="hover:text-brand-primary">{t("site.chrome.privacy")}</a></li>
              <li><a href={`/legal/${site.tenant.slug}/imprint`} className="hover:text-brand-primary">{t("site.chrome.imprint")}</a></li>
              <li><a href={`/legal/${site.tenant.slug}/cookies`} className="hover:text-brand-primary">{t("site.chrome.cookies")}</a></li>
              <li><CookieSettingsButton className="hover:text-brand-primary" label={t("site.chrome.cookieSettings")} /></li>
            </ul>
          </div>
        </div>
      </footer>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(orgLd) }} />
      {!ctx.preview && s.analytics.provider && s.analytics.id && (
        <ConsentGate category="analytics">
          {s.analytics.provider === "plausible" ? (
            <Script defer data-domain={s.analytics.id} src="https://plausible.io/js/script.js" strategy="afterInteractive" />
          ) : (
            <>
              <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(s.analytics.id)}`} strategy="afterInteractive" />
              <Script id="site-ga4" strategy="afterInteractive">
                {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(s.analytics.id)},{anonymize_ip:true});`}
              </Script>
            </>
          )}
        </ConsentGate>
      )}
    </div>
  );
}

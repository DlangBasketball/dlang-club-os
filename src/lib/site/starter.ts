import { newBlockId, type Block, type LiveSource, type MediaRef, type PageContent } from "./blocks";

/**
 * Starter site generator (pure): a complete, good-looking site for any club
 * from what the club already has in the app. The server wrapper passes the
 * club name, the cleared cover photo, which modules have public data, the
 * enabled site languages and a translator per language (texts come from the
 * app's message catalogs: site.starter.*, nearest catalog for languages the
 * app UI does not ship). Live blocks keep the pages current automatically.
 */

export type StarterInput = {
  clubName: string;
  coverPath: string | null;
  languages: readonly string[];
  has: { camps: boolean; programs: boolean; teams: boolean; coaches: boolean; training: boolean; shop: boolean; campaigns: boolean; news: boolean; events: boolean };
  /** Translate a site.starter.* key for a language. */
  t: (lang: string, key: string, vars?: Record<string, string | number>) => string;
  /** App paths (camps basket, booking) of the club. */
  links: { camps: string; book: string; shop: string; donate: string; login: string };
};

export type StarterPage = { path: string; key: string; showInNav: boolean; position: number; content: PageContent };

const live = (source: LiveSource, extra: Partial<Extract<Block, { type: "live" }>> = {}): Block => ({ id: newBlockId(), type: "live", source, limit: 6, ...extra });

export function buildStarterSite(input: StarterInput): StarterPage[] {
  const pages: { path: string; key: string; nav: boolean; build: (lang: string) => Block[] }[] = [];
  const t = input.t;
  const cover: MediaRef | null = input.coverPath ? { path: input.coverPath, focalX: 50, focalY: 50 } : null;
  const h = input.has;
  const hero = (lang: string, key: string, ctas: { label: string; href: string; style: "primary" | "secondary" }[] = [], height: "full" | "large" | "medium" = "medium"): Block => ({
    id: newBlockId(), type: "hero", eyebrow: input.clubName, headline: t(lang, `site.starter.${key}.title`, { club: input.clubName }),
    subheadline: t(lang, `site.starter.${key}.lead`, { club: input.clubName }), image: cover, overlay: 50, height, align: "start", ctas,
  });

  pages.push({
    path: "/", key: "home", nav: false,
    build: (lang) => [
      {
        ...(hero(lang, "home", [
          ...(h.camps ? [{ label: t(lang, "site.starter.cta.camps"), href: input.links.camps, style: "primary" as const }] : []),
          ...(h.training ? [{ label: t(lang, "site.starter.cta.book"), href: input.links.book, style: "secondary" as const }] : []),
          ...(!h.camps && !h.training ? [{ label: t(lang, "site.starter.cta.contact"), href: "/contact", style: "primary" as const }] : []),
        ], "full") as Extract<Block, { type: "hero" }>),
        headline: input.clubName,
      },
      ...(h.camps ? [live("camps", { eyebrow: t(lang, "site.starter.home.campsEyebrow"), heading: t(lang, "site.starter.home.campsHeading") })] : []),
      ...(h.programs ? [live("programs", { heading: t(lang, "site.starter.home.programsHeading") })] : []),
      ...(h.training ? [live("training", { heading: t(lang, "site.starter.home.trainingHeading"), limit: 3 })] : []),
      ...(h.events ? [live("schedule", { heading: t(lang, "site.starter.home.scheduleHeading"), limit: 5 })] : []),
      ...(h.news ? [live("news", { heading: t(lang, "site.starter.home.newsHeading"), limit: 3 })] : []),
      { id: newBlockId(), type: "cta", heading: t(lang, "site.starter.home.joinHeading", { club: input.clubName }), text: t(lang, "site.starter.home.joinText"), tone: "brand", ctas: [{ label: t(lang, "site.starter.cta.join"), href: "/join-us", style: "primary" }] },
    ],
  });
  pages.push({
    path: "/about-us", key: "about", nav: true,
    build: (lang) => [
      hero(lang, "about"),
      { id: newBlockId(), type: "richText", html: `<p>${esc(t(lang, "site.starter.about.body", { club: input.clubName }))}</p>`, width: "narrow" },
      ...(h.coaches ? [live("coaches", { heading: t(lang, "site.starter.about.coachesHeading"), limit: 12 })] : []),
    ],
  });
  if (h.camps) pages.push({ path: "/camps", key: "camps", nav: true, build: (lang) => [hero(lang, "camps", [{ label: t(lang, "site.starter.cta.camps"), href: input.links.camps, style: "primary" }]), live("camps", { limit: 24 })] });
  if (h.programs) pages.push({ path: "/programs", key: "programs", nav: true, build: (lang) => [hero(lang, "programs"), live("programs", { limit: 24 })] });
  if (h.teams) pages.push({ path: "/teams", key: "teams", nav: true, build: (lang) => [hero(lang, "teams"), live("teams", { limit: 24 }), ...(h.events ? [live("schedule", { heading: t(lang, "site.starter.home.scheduleHeading"), limit: 8 })] : [])] });
  if (h.coaches) pages.push({ path: "/staff", key: "staff", nav: false, build: (lang) => [hero(lang, "staff"), live("coaches", { limit: 24 })] });
  if (h.training) pages.push({ path: "/pro-training", key: "training", nav: true, build: (lang) => [hero(lang, "training", [{ label: t(lang, "site.starter.cta.book"), href: input.links.book, style: "primary" }]), live("training", { limit: 12 })] });
  if (h.events) pages.push({ path: "/schedule", key: "schedule", nav: true, build: (lang) => [hero(lang, "schedule"), live("schedule", { limit: 20 }), live("results", { heading: t(lang, "site.starter.schedule.resultsHeading"), limit: 8 }), live("calendar")] });
  if (h.shop) pages.push({ path: "/merchandise", key: "shop", nav: true, build: (lang) => [hero(lang, "shop", [{ label: t(lang, "site.starter.cta.shop"), href: input.links.shop, style: "primary" }]), live("shop", { limit: 12 })] });
  if (h.campaigns) pages.push({ path: "/support-us", key: "donate", nav: false, build: (lang) => [hero(lang, "donate"), live("campaigns", { limit: 6 })] });
  pages.push({ path: "/news", key: "news", nav: true, build: (lang) => [hero(lang, "news"), live("news", { limit: 24 })] });
  pages.push({ path: "/join-us", key: "join", nav: false, build: (lang) => [hero(lang, "join"), { id: newBlockId(), type: "form", kind: "join", heading: t(lang, "site.starter.join.formHeading") }] });
  pages.push({ path: "/contact", key: "contact", nav: true, build: (lang) => [hero(lang, "contact"), { id: newBlockId(), type: "form", kind: "contact", heading: t(lang, "site.starter.contact.formHeading") }] });

  return pages.map((p, position) => ({
    path: p.path,
    key: p.key,
    showInNav: p.nav,
    position,
    content: Object.fromEntries(
      input.languages.map((lang) => [
        lang,
        {
          title: p.key === "home" ? input.clubName : t(lang, `site.starter.${p.key}.nav`),
          metaDescription: t(lang, `site.starter.${p.key}.lead`, { club: input.clubName }).slice(0, 300),
          state: "ok" as const,
          blocks: p.build(lang),
        },
      ]),
    ),
  }));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

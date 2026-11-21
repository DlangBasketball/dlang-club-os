import { localizedPath } from "./paths";

/**
 * Site navigation (pure). The header menu is the club's custom menu when set
 * (site_settings.header_nav), otherwise it is built from the page tree:
 * published top-level pages marked "show in menu", in tree order, with their
 * published children as a dropdown. Labels follow the page language and fall
 * back to the site default language.
 */

export type NavPage = { id: string; path: string; parentId: string | null; position: number; showInNav: boolean; titles: Record<string, string> };
export type CustomNavItem = { label: Record<string, string>; href: string; children?: CustomNavItem[] };
export type NavLinkOut = { label: string; href: string; current: boolean; children?: NavLinkOut[] };

const pick = (rec: Record<string, string> | undefined, lang: string, def: string): string =>
  (rec && (rec[lang] || rec[lang.split("-")[0]!] || rec[def] || Object.values(rec)[0])) || "";

function localHref(href: string, lang: string, def: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  if (/^\/(register|book|shop|club|login|legal|signup|api)(\/|$|\?)/.test(href)) return href;
  return localizedPath(href, lang, def);
}

export function buildNav(opts: { custom: readonly CustomNavItem[]; pages: readonly NavPage[]; lang: string; defaultLang: string; currentPath: string; max?: number }): NavLinkOut[] {
  const { lang, defaultLang: def, currentPath } = opts;
  const max = opts.max ?? 8;
  const isCur = (path: string) => path === currentPath || (path !== "/" && currentPath.startsWith(`${path}/`));
  if (opts.custom.length) {
    const map = (it: CustomNavItem, depth: number): NavLinkOut | null => {
      const label = pick(it.label, lang, def);
      if (!label || typeof it.href !== "string") return null;
      return {
        label,
        href: localHref(it.href, lang, def),
        current: it.href.startsWith("/") && isCur(it.href),
        children: depth === 0 && it.children?.length ? (it.children.map((c) => map(c, 1)).filter(Boolean) as NavLinkOut[]) : undefined,
      };
    };
    return opts.custom.map((c) => map(c, 0)).filter((x): x is NavLinkOut => !!x).slice(0, max);
  }
  const byParent = new Map<string | null, NavPage[]>();
  for (const p of opts.pages) {
    const k = p.parentId;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(p);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position || a.path.localeCompare(b.path));
  const top = (byParent.get(null) ?? []).filter((p) => p.showInNav && p.path !== "/" && pick(p.titles, lang, def));
  return top.slice(0, max).map((p) => ({
    label: pick(p.titles, lang, def),
    href: localizedPath(p.path, lang, def),
    current: isCur(p.path),
    children: (byParent.get(p.id) ?? [])
      .filter((c) => pick(c.titles, lang, def))
      .slice(0, 12)
      .map((c) => ({ label: pick(c.titles, lang, def), href: localizedPath(c.path, lang, def), current: isCur(c.path) })),
  }));
}

/** Languages a page is published in (titles present), default first. */
export function pageLanguages(titles: Record<string, string>, siteLanguages: readonly string[], def: string): string[] {
  const have = siteLanguages.filter((l) => typeof titles[l] === "string" && titles[l]!.trim());
  return [...have.filter((l) => l === def), ...have.filter((l) => l !== def)];
}

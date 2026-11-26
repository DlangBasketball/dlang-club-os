import { isLanguageTag } from "./languages";
import { localizedPath } from "./paths";
import { safeSiteHref } from "./sanitize";

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

export const MAX_NAV_ITEMS = 12;
export const MAX_NAV_CHILDREN = 20;

/**
 * Validate a stored / submitted custom menu: labels per language tag
 * (max 60 chars), hrefs that are site paths, https URLs, mailto / tel, or ""
 * for a dropdown parent without a page (kept only with children).
 */
export function cleanNav(raw: unknown): CustomNavItem[] {
  const one = (v: unknown, depth: number): CustomNavItem | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const label: Record<string, string> = {};
    if (o.label && typeof o.label === "object" && !Array.isArray(o.label)) {
      for (const [k, x] of Object.entries(o.label as Record<string, unknown>)) {
        if (isLanguageTag(k) && typeof x === "string" && x.trim()) label[k] = x.trim().slice(0, 60);
      }
    }
    if (!Object.keys(label).length) return null;
    const rawHref = typeof o.href === "string" ? o.href.trim() : "";
    const href = rawHref ? safeSiteHref(rawHref)?.href ?? null : "";
    if (href === null) return null;
    const children = depth === 0 && Array.isArray(o.children) ? (o.children.map((c) => one(c, 1)).filter(Boolean) as CustomNavItem[]).slice(0, MAX_NAV_CHILDREN) : [];
    if (!href && !children.length) return null;
    return { label, href, ...(children.length ? { children } : {}) };
  };
  return Array.isArray(raw) ? (raw.map((x) => one(x, 0)).filter(Boolean) as CustomNavItem[]).slice(0, MAX_NAV_ITEMS) : [];
}

/** Menu editor: make top-level item `i` a sub-item of the item above it (items with sub-items stay top-level). */
export function indentNavItem(list: readonly CustomNavItem[], i: number): CustomNavItem[] {
  const it = list[i];
  const parent = list[i - 1];
  if (i < 1 || !it || !parent || it.children?.length || (parent.children?.length ?? 0) >= MAX_NAV_CHILDREN) return [...list];
  const out = [...list];
  out[i - 1] = { ...parent, children: [...(parent.children ?? []), { label: it.label, href: it.href }] };
  out.splice(i, 1);
  return out;
}

/** Menu editor: move sub-item `c` of item `p` to the top level, right after its parent. */
export function outdentNavItem(list: readonly CustomNavItem[], p: number, c: number): CustomNavItem[] {
  const parent = list[p];
  const child = parent?.children?.[c];
  if (!parent || !child || list.length >= MAX_NAV_ITEMS) return [...list];
  const out = [...list];
  const rest = parent.children!.filter((_, k) => k !== c);
  out[p] = { ...parent, ...(rest.length ? { children: rest } : { children: undefined }) };
  out.splice(p + 1, 0, { label: child.label, href: child.href });
  return out;
}

export function buildNav(opts: { custom: readonly CustomNavItem[]; pages: readonly NavPage[]; lang: string; defaultLang: string; currentPath: string; max?: number }): NavLinkOut[] {
  const { lang, defaultLang: def, currentPath } = opts;
  const max = opts.max ?? (opts.custom.length ? MAX_NAV_ITEMS : 8);
  const isCur = (path: string) => path === currentPath || (path !== "/" && currentPath.startsWith(`${path}/`));
  if (opts.custom.length) {
    const map = (it: CustomNavItem, depth: number): NavLinkOut | null => {
      const label = pick(it.label, lang, def);
      if (!label || typeof it.href !== "string") return null;
      const children = depth === 0 && it.children?.length ? (it.children.map((c) => map(c, 1)).filter(Boolean) as NavLinkOut[]) : undefined;
      // A dropdown parent without its own page ("" href) needs children.
      if (!it.href && !children?.length) return null;
      return {
        label,
        href: it.href ? localHref(it.href, lang, def) : "",
        current: (it.href.startsWith("/") && isCur(it.href)) || !!children?.some((c) => c.current),
        children,
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

/**
 * Switcher languages: every site language once the site has more than one
 * (untranslated pages show the default content with a note, so every link
 * works), default first; otherwise the page's own languages.
 */
export function switcherLanguages(siteLangs: readonly string[], pageLangs: readonly string[], def: string): string[] {
  const all = siteLangs.length > 1 ? siteLangs : pageLangs;
  return [...all.filter((l) => l === def), ...all.filter((l) => l !== def)];
}

/** Languages a page is published in (titles present), default first. */
export function pageLanguages(titles: Record<string, string>, siteLanguages: readonly string[], def: string): string[] {
  const have = siteLanguages.filter((l) => typeof titles[l] === "string" && titles[l]!.trim());
  return [...have.filter((l) => l === def), ...have.filter((l) => l !== def)];
}

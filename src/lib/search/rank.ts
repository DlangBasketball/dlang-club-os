/**
 * Global search (command palette): pure helpers shared by the server action
 * and the unit tests. The database (public.global_search) is the authority
 * on what a user may see; these helpers decide which kinds to ask for per
 * role, where each result links to, rank and cap the merged list, and add
 * the app pages the user can open.
 */
import type { AppRole } from "@/lib/auth/roles";

export const SEARCH_KINDS = ["athlete", "family", "coach", "program", "camp", "team", "invoice", "product", "page"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export type SearchHit = { kind: SearchKind; id: string; title: string; subtitle: string | null; href: string; score: number };

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_RESULTS = 20;

/** Lower-case, strip accents (mirrors public.search_fold). */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "s").toLowerCase();
}

/** 300 prefix, 200 word prefix, 100 contains, 0 no match; shorter titles first within a tier. */
export function scoreMatch(query: string, text: string): number {
  const q = fold(query.trim());
  const f = fold(text);
  if (q.length < SEARCH_MIN_CHARS || !f.includes(q)) return 0;
  const tier = f.startsWith(q) ? 300 : f.includes(` ${q}`) ? 200 : 100;
  return tier - Math.min(text.length, 99);
}

/**
 * Kinds a role may search. Finance gets names but never medical data (the
 * search returns no medical fields at all); parents only their own family's
 * records; coaches their athletes and the club's programmes and teams.
 */
export function kindsForRoles(roles: AppRole[]): SearchKind[] {
  const set = new Set<SearchKind>(["page", "product"]);
  if (roles.includes("admin") || roles.includes("finance")) {
    for (const k of SEARCH_KINDS) set.add(k);
  }
  if (roles.includes("coach")) for (const k of ["athlete", "coach", "program", "camp", "team"] as const) set.add(k);
  if (roles.includes("parent")) for (const k of ["athlete", "family", "program", "camp", "team", "invoice"] as const) set.add(k);
  return SEARCH_KINDS.filter((k) => set.has(k));
}

/** Which app the user is in decides where a hit links to. */
export type SearchArea = "admin" | "coach" | "parent";

export function areaForRoles(roles: AppRole[]): SearchArea {
  if (roles.includes("admin") || roles.includes("finance")) return "admin";
  if (roles.includes("coach")) return "coach";
  return "parent";
}

export function hrefFor(kind: Exclude<SearchKind, "page">, id: string, area: SearchArea): string {
  const e = encodeURIComponent(id);
  if (area === "admin") {
    switch (kind) {
      case "athlete": return `/admin/athletes/${e}`;
      case "family": return `/admin/families/${e}`;
      case "coach": return `/admin/coaches/${e}`;
      case "program": case "camp": return `/admin/programs/${e}`;
      case "team": return `/admin/teams/${e}`;
      case "invoice": return `/admin/invoices/${e}`;
      case "product": return `/admin/shop/${e}`;
    }
  }
  if (area === "coach") {
    switch (kind) {
      case "athlete": return `/coach/training/${e}`;
      case "team": return "/coach/team";
      case "product": return "/shop";
      default: return "/coach/schedule";
    }
  }
  switch (kind) {
    case "athlete": return `/parent/children/${e}`;
    case "invoice": return `/parent/invoices/${e}`;
    case "camp": return "/parent/camps";
    case "product": return "/shop";
    case "family": return "/parent/account";
    default: return "/parent/schedule";
  }
}

export type SearchPage = { href: string; labelKey: string; keywords: string; roles: AppRole[] };

/** Pages anyone can jump to, filtered by role. labelKey is under "nav.". */
export function pagesFor(pages: SearchPage[], roles: AppRole[], query: string, t: (key: string) => string): SearchHit[] {
  return pages
    .filter((p) => p.roles.some((r) => roles.includes(r)))
    .map((p) => {
      const label = t(p.labelKey);
      const score = Math.max(scoreMatch(query, label), scoreMatch(query, p.keywords) - 50);
      return { kind: "page" as const, id: p.href, title: label, subtitle: null, href: p.href, score };
    })
    .filter((h) => h.score > 0);
}

/** Merge record hits and page hits: allowed kinds only, best first, capped, no duplicates. */
export function rankHits(hits: SearchHit[], allowed: SearchKind[], limit = SEARCH_MAX_RESULTS): SearchHit[] {
  const ok = new Set(allowed);
  const seen = new Set<string>();
  return hits
    .filter((h) => ok.has(h.kind) && h.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .filter((h) => {
      const key = `${h.kind}:${h.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Math.min(limit, 50)));
}

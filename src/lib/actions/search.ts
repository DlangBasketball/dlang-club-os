"use server";

import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { NAV } from "@/components/layout/nav-config";
import { shopDb } from "@/lib/shop/db";
import { logError } from "@/lib/log";
import {
  areaForRoles, hrefFor, kindsForRoles, pagesFor, rankHits, SEARCH_MAX_RESULTS, SEARCH_MIN_CHARS,
  type SearchHit, type SearchKind, type SearchPage,
} from "@/lib/search/rank";

/**
 * Command palette search. Server-side and tenant-scoped: the records come
 * from public.global_search(), which applies the caller's org and roles
 * (finance: no medical data; parents: their own children / invoices;
 * coaches: their athletes). Pages come from the app navigation of the
 * user's own areas.
 */
const PAGES: SearchPage[] = [
  ...NAV.admin.map((i) => ({ href: i.href, labelKey: `nav.${i.labelKey}`, keywords: i.label, roles: ["admin", "finance"] as SearchPage["roles"] })),
  ...NAV.coach.map((i) => ({ href: i.href, labelKey: `nav.${i.labelKey}`, keywords: i.label, roles: ["coach"] as SearchPage["roles"] })),
  ...NAV.parent.map((i) => ({ href: i.href, labelKey: `nav.${i.labelKey}`, keywords: i.label, roles: ["parent"] as SearchPage["roles"] })),
];

export type SearchResult = { ok: true; hits: SearchHit[] } | { ok: false; error: string };

export async function globalSearch(query: string): Promise<SearchResult> {
  const me = await getSessionUser();
  const t = await getTranslations(me?.orgId);
  if (!me?.orgId || !(await tenantMatchesOrg(me.orgId))) return { ok: false, error: t("search.errors.notPermitted") };
  const q = typeof query === "string" ? query.trim().slice(0, 80) : "";
  if (q.length < SEARCH_MIN_CHARS) return { ok: true, hits: [] };

  const allowed = kindsForRoles(me.roles);
  const area = areaForRoles(me.roles);
  const recordKinds = allowed.filter((k) => k !== "page");
  let records: SearchHit[] = [];
  try {
    const db = await shopDb();
    const { data, error } = await db.rpc("global_search", { p_q: q, p_kinds: recordKinds, p_limit: SEARCH_MAX_RESULTS });
    if (error) throw error;
    records = (data ?? []).map((r) => {
      const kind = r.kind as Exclude<SearchKind, "page">;
      return { kind, id: r.id, title: r.title, subtitle: r.subtitle, href: hrefFor(kind, r.id, area), score: r.score };
    });
  } catch (e) {
    logError("search.global", e);
    return { ok: false, error: t("search.errors.failed") };
  }
  const pages = pagesFor(PAGES, me.roles, q, (k) => t.dynamic(k, undefined, k));
  return { ok: true, hits: rankHits([...records, ...pages], allowed) };
}

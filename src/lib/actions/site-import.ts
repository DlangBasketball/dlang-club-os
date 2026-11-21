"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { getTenant, tenantMatchesOrg } from "@/lib/tenant/server";
import { writeAudit } from "@/lib/people/server";
import { logError } from "@/lib/log";
import type { WebsiteDb } from "@/lib/website/server";
import { parseLanguageList } from "@/lib/site/languages";
import { revalidateSite } from "@/lib/site/revalidate";
import { importErrorCode, loadWordPress, normalizeBaseUrl, runWordPressImport, type ImportPlan, type ImportReport } from "@/lib/site/wp-import";

/**
 * Admin -> Site -> Import: preview, then import, the club's current
 * WordPress website. Admin of the signed-in org only; the request host must
 * belong to it; writes go through the RLS-scoped session client.
 */

export type ImportResult<T> = { ok: true; message: string; data: T } | { ok: false; error: string };

async function context() {
  const t = await getTranslations();
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin") || !(await tenantMatchesOrg(me.orgId))) return { t, error: t("site.errors.forbidden") } as const;
  const db = (await createClient()) as unknown as WebsiteDb;
  const { data } = await db.from("site_settings").select("languages,default_language").eq("org_id", me.orgId).maybeSingle();
  let languages = (data as { languages?: string[] } | null)?.languages ?? [];
  let defaultLanguage = (data as { default_language?: string } | null)?.default_language ?? "";
  if (!languages.length) {
    const tenant = await getTenant();
    languages = parseLanguageList(tenant.supportedLocales?.length ? tenant.supportedLocales : [tenant.defaultLocale || "en"]).tags;
    defaultLanguage = languages.includes(tenant.defaultLocale) ? tenant.defaultLocale : languages[0] ?? "en";
    await db.from("site_settings").upsert({ org_id: me.orgId, languages, default_language: defaultLanguage }, { onConflict: "org_id" });
  }
  return { t, me: { id: me.id, orgId: me.orgId }, db, languages, defaultLanguage } as const;
}

const urlInput = z.string().trim().min(4).max(300);

export async function previewSiteImport(url: string): Promise<ImportResult<ImportPlan>> {
  const c = await context();
  if ("error" in c) return { ok: false, error: c.error! };
  const base = urlInput.safeParse(url).success ? normalizeBaseUrl(url) : null;
  if (!base) return { ok: false, error: c.t("site.import.errors.unsafe_url") };
  try {
    const { data: pages } = await c.db.from("site_pages").select("path").eq("org_id", c.me.orgId);
    const taken = new Set(((pages ?? []) as { path: string }[]).map((p) => p.path));
    const { plan } = await loadWordPress(base, { languages: c.languages, defaultLanguage: c.defaultLanguage, takenPaths: taken });
    return { ok: true, message: c.t("site.import.previewReady", { pages: plan.pages.filter((p) => !p.skip).length, posts: plan.posts.length }), data: plan };
  } catch (e) {
    const code = importErrorCode(e);
    if (code === "network") logError("site.import.preview", e);
    return { ok: false, error: c.t.dynamic(`site.import.errors.${code}`, {}, c.t("site.import.errors.network")) };
  }
}

const runInput = z.object({ url: urlInput, clearedForPublic: z.boolean(), publish: z.boolean() });

export async function runSiteImport(input: z.input<typeof runInput>): Promise<ImportResult<ImportReport>> {
  const c = await context();
  if ("error" in c) return { ok: false, error: c.error! };
  const p = runInput.safeParse(input);
  const base = p.success ? normalizeBaseUrl(p.data.url) : null;
  if (!p.success || !base) return { ok: false, error: c.t("site.import.errors.unsafe_url") };
  try {
    const { report } = await runWordPressImport(c.db, {
      orgId: c.me.orgId, actorId: c.me.id, baseUrl: base, languages: c.languages, defaultLanguage: c.defaultLanguage,
      clearedForPublic: p.data.clearedForPublic, publish: p.data.publish,
    });
    await writeAudit(c.me, "site.import", "site_pages", null, { ...report, clearedForPublic: p.data.clearedForPublic, publish: p.data.publish });
    revalidateSite(c.me.orgId);
    revalidatePath("/admin/site", "layout");
    revalidatePath("/admin/media");
    return { ok: true, message: c.t("site.import.done", { pages: report.pagesCreated + report.pagesUpdated, posts: report.postsCreated + report.postsUpdated, images: report.imagesImported }), data: report };
  } catch (e) {
    const code = importErrorCode(e);
    logError("site.import.run", e);
    return { ok: false, error: c.t.dynamic(`site.import.errors.${code}`, {}, c.t("site.import.errors.network")) };
  }
}

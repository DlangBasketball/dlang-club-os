"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { writeAudit } from "@/lib/people/server";
import { getWebsiteSettings, type WebsiteDb } from "@/lib/website/server";
import { IMPORT_KINDS, applyImport, loadSources, previewImport, type ImportPreview, type ImportResult } from "@/lib/website/importers/run";
import { notifyWebsite } from "@/lib/website/webhooks";

/**
 * Admin -> Website -> Import. Reads the club's configured website URL
 * (never a URL from the client), server-side only, through the public
 * WordPress REST API. Preview first; the import re-fetches the source (the
 * client never sends rows to write) and is idempotent by source id.
 */

export type ImportActionResult<T> = { ok: true; data: T; message?: string } | { ok: false; error: string };

const input = z.object({
  kinds: z.array(z.enum(IMPORT_KINDS)).min(1).max(IMPORT_KINDS.length),
  ourTeams: z.array(z.string().regex(/^\d{1,18}$/)).max(200).default([]),
});

async function requireOwnAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return { id: me.id, orgId: me.orgId };
}

export async function previewWebsiteImport(raw: z.input<typeof input>): Promise<ImportActionResult<ImportPreview>> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if (!me) return { ok: false, error: t("website.errors.forbidden") };
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, error: t("website.errors.invalid") };
  const settings = await getWebsiteSettings(me.orgId);
  if (!settings.websiteUrl) return { ok: false, error: t("website.import.errors.noWebsiteUrl") };
  const sources = await loadSources(settings.websiteUrl, p.data.kinds);
  const db = (await createClient()) as unknown as WebsiteDb;
  return { ok: true, data: await previewImport(db, me.orgId, sources, new Set(p.data.ourTeams)) };
}

export async function runWebsiteImport(raw: z.input<typeof input> & { dryRun: boolean; defaultStock?: number }): Promise<ImportActionResult<ImportResult>> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if (!me) return { ok: false, error: t("website.errors.forbidden") };
  const p = input.safeParse(raw);
  const dryRun = raw?.dryRun !== false;
  const defaultStock = Number.isFinite(raw?.defaultStock) ? Math.max(0, Math.min(999, Math.floor(raw.defaultStock!))) : 0;
  if (!p.success) return { ok: false, error: t("website.errors.invalid") };
  const settings = await getWebsiteSettings(me.orgId);
  if (!settings.websiteUrl) return { ok: false, error: t("website.import.errors.noWebsiteUrl") };
  const sources = await loadSources(settings.websiteUrl, p.data.kinds);
  const db = (await createClient()) as unknown as WebsiteDb;
  const result = await applyImport(db, me, sources, { ourTeams: new Set(p.data.ourTeams), dryRun, defaultStock });
  if (!dryRun) {
    await writeAudit(me, "website.import", "website_import_map", null, {
      kinds: p.data.kinds,
      teams: result.teams, events: result.events, products: result.products, posts: result.posts, images: result.images,
    });
    notifyWebsite(me.orgId, "teams", "events", "results", "shop", "news");
    revalidatePath("/admin/settings/website", "layout");
    revalidatePath("/admin/shop");
    revalidatePath("/admin/teams");
    revalidatePath("/admin/schedule");
  }
  return { ok: true, data: result, message: t(dryRun ? "website.import.messages.dryRunDone" : "website.import.messages.done") };
}

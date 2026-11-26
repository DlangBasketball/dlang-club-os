"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { writeAudit } from "@/lib/people/server";
import { getWebsiteSettings, type WebsiteDb } from "@/lib/website/server";
import { IMPORT_KINDS, applyImport, loadSources, previewImport, type ImportPreview, type ImportResult } from "@/lib/website/importers/run";
import { NEW_TEAM } from "@/lib/website/importers/team-match";
import { notifyWebsite } from "@/lib/website/webhooks";

/**
 * Admin -> Website -> Import. Reads the club's configured website URL
 * (never a URL from the client), server-side only, through the public
 * WordPress REST API. Preview first; the import re-fetches the source (the
 * client never sends rows to write, only choices: which website teams are
 * the club's, which app team each maps to, which products to import) and is
 * idempotent by source id. App team ids are re-checked against the admin's
 * own org on the server.
 */

export type ImportActionResult<T> = { ok: true; data: T; message?: string } | { ok: false; error: string };

const sourceId = z.string().regex(/^\d{1,18}$/);

const input = z.object({
  kinds: z.array(z.enum(IMPORT_KINDS)).min(1).max(IMPORT_KINDS.length),
  ourTeams: z.array(sourceId).max(200).default([]),
});

const runInput = input.extend({
  /** website team source id -> app team id, or "new" (explicit). */
  teamMap: z.record(sourceId, z.union([z.string().uuid(), z.literal(NEW_TEAM)])).default({}),
  /** Selected WooCommerce product source ids; omitted = default pre-selection. */
  products: z.array(sourceId).max(5000).optional(),
});

async function requireOwnAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return { id: me.id, orgId: me.orgId };
}

export async function previewWebsiteImport(raw: z.input<typeof input>): Promise<ImportActionResult<ImportPreview>> {
  await assertFeature("website_connect");
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

export async function runWebsiteImport(raw: z.input<typeof runInput> & { dryRun: boolean; defaultStock?: number }): Promise<ImportActionResult<ImportResult>> {
  await assertFeature("website_connect");
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if (!me) return { ok: false, error: t("website.errors.forbidden") };
  const p = runInput.safeParse(raw);
  const dryRun = raw?.dryRun !== false;
  const defaultStock = Number.isFinite(raw?.defaultStock) ? Math.max(0, Math.min(999, Math.floor(raw.defaultStock!))) : 0;
  if (!p.success) return { ok: false, error: t("website.errors.invalid") };
  const ourTeams = new Set(p.data.ourTeams);
  const teamMap = new Map(Object.entries(p.data.teamMap).filter(([k]) => ourTeams.has(k)));
  // Every ticked website team needs an explicit app team (or "create new").
  if (p.data.kinds.includes("sportspress") && [...ourTeams].some((id) => !teamMap.has(id))) {
    return { ok: false, error: t("website.import.errors.teamUnmapped") };
  }
  const settings = await getWebsiteSettings(me.orgId);
  if (!settings.websiteUrl) return { ok: false, error: t("website.import.errors.noWebsiteUrl") };
  const sources = await loadSources(settings.websiteUrl, p.data.kinds);
  const db = (await createClient()) as unknown as WebsiteDb;
  const result = await applyImport(db, me, sources, {
    ourTeams, teamMap, selectedProducts: p.data.products ? new Set(p.data.products) : null, dryRun, defaultStock,
  });
  if (!dryRun) {
    await writeAudit(me, "website.import", "website_import_map", null, {
      kinds: p.data.kinds,
      teams: result.teams, events: result.events, products: result.products, posts: result.posts, images: result.images,
      productsSkipped: result.productsSkipped,
    });
    notifyWebsite(me.orgId, "teams", "events", "results", "shop", "news");
    revalidatePath("/admin/settings/website", "layout");
    revalidatePath("/admin/shop");
    revalidatePath("/admin/teams");
    revalidatePath("/admin/schedule");
  }
  return { ok: true, data: result, message: t(dryRun ? "website.import.messages.dryRunDone" : "website.import.messages.done") };
}

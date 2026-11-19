"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { writeAudit } from "@/lib/people/server";
import { logError } from "@/lib/log";
import { parseOriginList } from "@/lib/website/origins";
import { websiteSettingsInput, type WebsiteSettingsInput } from "@/lib/website/settings-shape";
import { sanitizeHtml, htmlToText } from "@/lib/website/sanitize";
import { getWebsiteSecret, rotateWebsiteSecret } from "@/lib/website/secret-store";
import { getWebsiteSettings, websiteDb, type WebsiteDb } from "@/lib/website/server";
import { notifyWebsite, postWebhook } from "@/lib/website/webhooks";

/**
 * Website connection admin actions. The org is ALWAYS the signed-in admin's
 * own org (never taken from the client) and the request host must belong to
 * it. Settings, flags and news go through the RLS-scoped session client
 * (admin-only policies re-check); the signing secret is written by the
 * service role only and its plaintext is returned exactly once.
 */

export type WebsiteActionResult<T = undefined> = { ok: true; message: string; data?: T } | { ok: false; error: string };

async function requireOwnAdmin(): Promise<{ id: string; orgId: string } | { error: string }> {
  const t = await getTranslations();
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return { error: t("website.errors.forbidden") };
  if (!(await tenantMatchesOrg(me.orgId))) return { error: t("website.errors.forbidden") };
  return { id: me.id, orgId: me.orgId };
}

async function sessionDb(): Promise<WebsiteDb> {
  return (await createClient()) as unknown as WebsiteDb;
}

function revalidateWebsite() {
  revalidatePath("/admin/settings/website", "layout");
  revalidatePath("/club", "layout");
}

const uuid = z.string().uuid();

/** Save the connection settings (origins arrive as typed text and are validated here). */
export async function saveWebsiteSettings(input: Omit<WebsiteSettingsInput, "allowedOrigins"> & { allowedOrigins: string }): Promise<WebsiteActionResult<{ invalidOrigins: string[] }>> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const { origins, invalid } = parseOriginList(typeof input?.allowedOrigins === "string" ? input.allowedOrigins : "");
  if (invalid.length) return { ok: false, error: t("website.errors.invalidOrigins", { list: invalid.slice(0, 5).join(", ") }) };
  const parsed = websiteSettingsInput.safeParse({ ...input, allowedOrigins: origins });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return { ok: false, error: t.dynamic(`website.errors.field.${field}`, {}, t("website.errors.invalid")) };
  }
  const v = parsed.data;
  if (v.enabled && v.allowedOrigins.length === 0) return { ok: false, error: t("website.errors.originsRequired") };
  const social = Object.fromEntries(Object.entries(v.socialLinks ?? {}).filter(([, url]) => !!url));
  const row = {
    org_id: me.orgId,
    enabled: v.enabled,
    website_url: v.websiteUrl || null,
    allowed_origins: v.allowedOrigins,
    public_sections: v.sections,
    roster_public: v.rosterPublic,
    embed_theme: v.embedTheme,
    webhook_url: v.webhookUrl || null,
    tagline: v.tagline || null,
    nav_links: v.navLinks,
    social_links: social,
  };
  const db = await sessionDb();
  const { error } = await db.from("website_settings").upsert(row, { onConflict: "org_id" });
  if (error) {
    logError("website.saveSettings", error);
    return { ok: false, error: t("website.errors.generic") };
  }
  await writeAudit(me, "website.settings.update", "website_settings", me.orgId, {
    enabled: v.enabled, origins: v.allowedOrigins.length, roster_public: v.rosterPublic, theme: v.embedTheme, webhook: Boolean(v.webhookUrl),
  });
  notifyWebsite(me.orgId, "club");
  revalidateWebsite();
  return { ok: true, message: t("website.messages.saved"), data: { invalidOrigins: [] } };
}

/** Generate or rotate the webhook signing secret. The plaintext is returned ONCE and never again. */
export async function rotateWebsiteWebhookSecret(): Promise<WebsiteActionResult<{ secret: string; hint: string }>> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const res = await rotateWebsiteSecret(me.orgId);
  if (!res) return { ok: false, error: t("website.errors.generic") };
  await writeAudit(me, "website.secret.rotate", "website_secrets", me.orgId, { hint: res.hint });
  revalidateWebsite();
  return { ok: true, message: t("website.messages.secretCreated"), data: res };
}

/** Send a signed test "content.updated" (resource "club") to the configured webhook URL now. */
export async function sendWebsiteTestWebhook(): Promise<WebsiteActionResult<{ status: number | null }>> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const settings = await getWebsiteSettings(me.orgId);
  const secret = await getWebsiteSecret(me.orgId);
  if (!settings.webhookUrl) return { ok: false, error: t("website.errors.noWebhookUrl") };
  if (!secret) return { ok: false, error: t("website.errors.noSecret") };
  const db = await sessionDb();
  const { data: org } = await db.from("organizations").select("slug").eq("id", me.orgId).maybeSingle();
  const slug = (org as { slug?: string } | null)?.slug;
  if (!slug) return { ok: false, error: t("website.errors.generic") };
  const now = new Date();
  const res = await postWebhook(settings.webhookUrl, secret, "club", slug, now);
  await websiteDb().from("website_settings").update({
    last_delivery_at: now.toISOString(), last_delivery_status: res.ok ? "sent" : "failed", last_delivery_code: res.status, last_delivery_error: res.error,
  }).eq("org_id", me.orgId);
  revalidateWebsite();
  if (!res.ok) return { ok: false, error: t("website.errors.testFailed", { detail: res.status ? `HTTP ${res.status}` : (res.error ?? "") }) };
  return { ok: true, message: t("website.messages.testSent", { status: res.status ?? 0 }), data: { status: res.status } };
}

const teamFlags = z.object({
  isPublic: z.boolean(),
  rosterPublic: z.boolean(),
  coverPublic: z.boolean(),
  slug: z.union([z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/), z.literal("")]),
  league: z.string().trim().max(120),
});

export async function setTeamWebsiteFlags(teamId: string, input: z.input<typeof teamFlags>): Promise<WebsiteActionResult> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const p = teamFlags.safeParse(input);
  if (!uuid.safeParse(teamId).success || !p.success) return { ok: false, error: t("website.errors.invalid") };
  const db = await sessionDb();
  const { data, error } = await db.from("teams").update({
    is_public: p.data.isPublic, roster_public: p.data.isPublic && p.data.rosterPublic, cover_public: p.data.isPublic && p.data.coverPublic,
    slug: p.data.slug || null, league: p.data.league || null,
  }).eq("id", teamId).eq("org_id", me.orgId).select("id");
  if (error) return { ok: false, error: t(error.code === "23505" ? "website.errors.slugTaken" : "website.errors.generic") };
  if (!data?.length) return { ok: false, error: t("website.errors.notFound") };
  await writeAudit(me, "website.team.flags", "teams", teamId, { public: p.data.isPublic, roster: p.data.rosterPublic, cover: p.data.coverPublic });
  notifyWebsite(me.orgId, "teams", "events", "results");
  revalidateWebsite();
  return { ok: true, message: t("website.messages.saved") };
}

export async function setCoachWebsiteFlags(coachId: string, input: { isPublic: boolean; photoPublic: boolean }): Promise<WebsiteActionResult> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(coachId).success || typeof input?.isPublic !== "boolean" || typeof input?.photoPublic !== "boolean") return { ok: false, error: t("website.errors.invalid") };
  const db = await sessionDb();
  const { data, error } = await db.from("coaches").update({ is_public: input.isPublic, photo_public: input.isPublic && input.photoPublic })
    .eq("id", coachId).eq("org_id", me.orgId).select("id");
  if (error) return { ok: false, error: t("website.errors.generic") };
  if (!data?.length) return { ok: false, error: t("website.errors.notFound") };
  await writeAudit(me, "website.coach.flags", "coaches", coachId, { public: input.isPublic, photo: input.photoPublic });
  notifyWebsite(me.orgId, "coaches", "teams");
  revalidateWebsite();
  return { ok: true, message: t("website.messages.saved") };
}

/** Show / hide a club calendar entry (club_events) or a club-wide alert on the website. */
export async function setPublicFlag(kind: "club_event" | "alert", id: string, isPublic: boolean): Promise<WebsiteActionResult> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(id).success || typeof isPublic !== "boolean" || (kind !== "club_event" && kind !== "alert")) return { ok: false, error: t("website.errors.invalid") };
  const db = await sessionDb();
  const table = kind === "club_event" ? "club_events" : "club_alerts";
  let q = db.from(table).update({ is_public: isPublic }).eq("id", id).eq("org_id", me.orgId);
  // Only club-wide alerts / everyone events may go public (never a team- or staff-only message).
  q = kind === "alert" ? q.eq("audience", "all") : q.eq("audience", "everyone");
  const { data, error } = await q.select("id");
  if (error) return { ok: false, error: t("website.errors.generic") };
  if (!data?.length) return { ok: false, error: t("website.errors.notFound") };
  await writeAudit(me, `website.${kind}.public`, table, id, { public: isPublic });
  notifyWebsite(me.orgId, kind === "alert" ? "news" : "events");
  revalidateWebsite();
  return { ok: true, message: t("website.messages.saved") };
}

const newsInput = z.object({
  title: z.string().trim().min(1).max(200),
  excerpt: z.string().trim().max(1000).optional().default(""),
  body: z.string().max(20000).optional().default(""),
  linkUrl: z.union([z.string().trim().url().max(500).refine((u) => u.startsWith("https://")), z.literal("")]).optional().default(""),
  isPublic: z.boolean(),
});

export async function saveWebsiteNews(id: string | null, input: z.input<typeof newsInput>): Promise<WebsiteActionResult<{ id: string }>> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const p = newsInput.safeParse(input);
  if (!p.success || (id !== null && !uuid.safeParse(id).success)) return { ok: false, error: t("website.errors.invalid") };
  // Plain text from the admin form -> safe paragraphs (no HTML is ever trusted).
  const body = p.data.body.trim();
  const html = body ? sanitizeHtml(body.split(/\n{2,}/).map((para) => `<p>${para.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`).join("")) : null;
  const row: Record<string, unknown> = {
    title: p.data.title, excerpt: p.data.excerpt || (body ? htmlToText(body, 300) : null), body_html: html,
    link_url: p.data.linkUrl || null, is_public: p.data.isPublic,
  };
  // Editing without a new body keeps the stored one (e.g. an imported post).
  if (id && !body) delete row.body_html;
  const db = await sessionDb();
  const res = id
    ? await db.from("website_news").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("website_news").insert({ ...row, org_id: me.orgId, source: "app", created_by: me.id }).select("id");
  if (res.error || !res.data?.length) return { ok: false, error: t(res.error ? "website.errors.generic" : "website.errors.notFound") };
  const newsId = (res.data[0] as { id: string }).id;
  await writeAudit(me, id ? "website.news.update" : "website.news.create", "website_news", newsId, { public: p.data.isPublic });
  notifyWebsite(me.orgId, "news");
  revalidateWebsite();
  return { ok: true, message: t("website.messages.saved"), data: { id: newsId } };
}

export async function deleteWebsiteNews(id: string): Promise<WebsiteActionResult> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("website.errors.invalid") };
  const db = await sessionDb();
  const { data, error } = await db.from("website_news").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error || !data?.length) return { ok: false, error: t(error ? "website.errors.generic" : "website.errors.notFound") };
  await writeAudit(me, "website.news.delete", "website_news", id);
  notifyWebsite(me.orgId, "news");
  revalidateWebsite();
  return { ok: true, message: t("website.messages.deleted") };
}

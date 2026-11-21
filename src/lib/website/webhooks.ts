import "server-only";
import { after } from "next/server";
import { revalidateSiteLive } from "@/lib/site/revalidate";
import { logError } from "@/lib/log";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, contentUpdatedBody, signBody } from "./hmac";
import { getWebsiteSecret } from "./secret-store";
import { getWebsiteSettings, websiteDb, type WebsiteDb } from "./server";
import { safeFetch } from "./ssrf";
import { MAX_ATTEMPTS, WEBHOOK_RESOURCES, isPermanentFailure, nextAttemptAt, type WebhookResource } from "./webhook-schedule";

export { WEBHOOK_RESOURCES, type WebhookResource } from "./webhook-schedule";

/**
 * "content.updated" webhooks to the club's website (cache purge). Changes are
 * queued in website_webhook_deliveries (one pending row per club + resource,
 * so bursts coalesce) and delivered best-effort right after the server
 * action, then retried with backoff by the cron (/api/website/cron). Never
 * blocks or fails the user's action.
 */

const CLAIM_MS = 5 * 60_000;

async function enqueue(orgId: string, resources: WebhookResource[], db: WebsiteDb): Promise<boolean> {
  const settings = await getWebsiteSettings(orgId, db);
  if (!settings.enabled || !settings.webhookUrl) return false;
  for (const resource of Array.from(new Set(resources))) {
    const { error } = await db.from("website_webhook_deliveries").insert({ org_id: orgId, resource });
    // 23505: a delivery for this resource is already pending (coalesced).
    if (error && error.code !== "23505") logError("website.webhook.enqueue", error, { resource });
  }
  return true;
}

/** Queue + send now (best-effort, after the response). Safe to call from any server action. */
export function notifyWebsite(orgId: string | null | undefined, ...resources: WebhookResource[]): void {
  if (!orgId || !resources.length) return;
  // The club's built-in site (src/lib/site/live.ts) caches live blocks under
  // this tag: app data changed, so they re-render on the next request.
  revalidateSiteLive(orgId);
  const run = async () => {
    try {
      const db = websiteDb();
      if (await enqueue(orgId, resources, db)) await deliverDue({ orgId, db });
    } catch (e) {
      logError("website.webhook.notify", e);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

type DeliveryRow = { id: string; org_id: string; resource: string; attempts: number };

export type DeliveryOutcome = { id: string; ok: boolean; status: number | null; error: string | null };

/** POST one signed payload. Never throws. */
export async function postWebhook(url: string, secret: string, resource: string, club: string, now: Date = new Date()): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const body = contentUpdatedBody(resource, club, now);
  try {
    const res = await safeFetch(url, {
      method: "POST",
      body,
      timeoutMs: 8_000,
      maxBytes: 64_000,
      maxRedirects: 0,
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: signBody(secret, body),
        [TIMESTAMP_HEADER]: String(Math.floor(now.getTime() / 1000)),
      },
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, error: res.status >= 200 && res.status < 300 ? null : `http_${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message.slice(0, 200) : "error" };
  }
}

/**
 * Deliver due pending rows (all clubs, or one). Each row is claimed first
 * (next_attempt_at pushed forward) so the cron and an immediate send never
 * post the same delivery twice.
 */
export async function deliverDue(opts: { orgId?: string; limit?: number; db?: WebsiteDb; now?: Date } = {}): Promise<DeliveryOutcome[]> {
  const db = opts.db ?? websiteDb();
  const now = opts.now ?? new Date();
  let q = db.from("website_webhook_deliveries").select("id,org_id,resource,attempts").eq("status", "pending").lte("next_attempt_at", now.toISOString());
  if (opts.orgId) q = q.eq("org_id", opts.orgId);
  const { data, error } = await q.order("next_attempt_at").limit(opts.limit ?? 100);
  if (error) {
    logError("website.webhook.due", error);
    return [];
  }
  const rows = (data ?? []) as DeliveryRow[];
  const outcomes: DeliveryOutcome[] = [];
  const orgCache = new Map<string, { url: string | null; secret: string | null; slug: string | null; enabled: boolean }>();
  for (const row of rows) {
    const { data: claimed } = await db.from("website_webhook_deliveries")
      .update({ next_attempt_at: new Date(now.getTime() + CLAIM_MS).toISOString() })
      .eq("id", row.id).eq("org_id", row.org_id).eq("status", "pending").lte("next_attempt_at", now.toISOString()).select("id");
    if (!claimed?.length) continue;
    if (!orgCache.has(row.org_id)) {
      const [settings, secret, { data: org }] = await Promise.all([
        getWebsiteSettings(row.org_id, db),
        getWebsiteSecret(row.org_id, db),
        db.from("organizations").select("slug").eq("id", row.org_id).maybeSingle(),
      ]);
      orgCache.set(row.org_id, { url: settings.webhookUrl, secret, slug: (org as { slug?: string } | null)?.slug ?? null, enabled: settings.enabled });
    }
    const o = orgCache.get(row.org_id)!;
    const attempts = row.attempts + 1;
    let res: { ok: boolean; status: number | null; error: string | null };
    if (!o.enabled || !o.url || !o.secret || !o.slug) res = { ok: false, status: null, error: "not_configured" };
    else res = await postWebhook(o.url, o.secret, row.resource, o.slug, now);
    const retryAt = res.ok || res.error === "not_configured" || (res.status !== null && isPermanentFailure(res.status)) ? null : nextAttemptAt(attempts, now);
    const status = res.ok ? "sent" : retryAt ? "pending" : "failed";
    await db.from("website_webhook_deliveries").update({
      status, attempts, last_attempt_at: now.toISOString(), response_code: res.status, last_error: res.error,
      sent_at: res.ok ? now.toISOString() : null, next_attempt_at: (retryAt ?? now).toISOString(),
    }).eq("id", row.id).eq("org_id", row.org_id);
    await db.from("website_settings").update({
      last_delivery_at: now.toISOString(), last_delivery_status: status, last_delivery_code: res.status, last_delivery_error: res.error,
    }).eq("org_id", row.org_id);
    outcomes.push({ id: row.id, ok: res.ok, status: res.status, error: res.error });
  }
  return outcomes;
}

export { MAX_ATTEMPTS };

import "server-only";
import { familyAdminDb } from "@/lib/family/db";
import { logError } from "@/lib/log";
import { buildPushPayload, type PushMessage } from "./payload";
import { sendWebPush, vapidFromEnv } from "./webpush";

/** Is Web Push configured on this deployment (VAPID keys set)? */
export function pushConfigured(): boolean {
  return vapidFromEnv() !== null;
}

/** Public key the browser needs to subscribe (safe to expose), or null. */
export function pushPublicKey(): string | null {
  return vapidFromEnv()?.publicKey ?? null;
}

/**
 * Sends one push per (recipient, device) registered in this club. Callers
 * have already applied the recipient's preferences (pushAllowedFor /
 * resolveDelivery). Graceful no-op without VAPID keys. Gone subscriptions
 * (404/410) are deleted; others count failures and are dropped after 5.
 * Never throws.
 */
export async function deliverPush(orgId: string, items: (PushMessage & { profileId: string })[]): Promise<number> {
  const keys = vapidFromEnv();
  if (!keys || !items.length) return 0;
  let sent = 0;
  try {
    const db = familyAdminDb();
    // Prospect demo sandboxes never send push notifications.
    const { data: demo } = await db.from("organizations").select("demo_sandbox_id").eq("id", orgId).maybeSingle();
    if ((demo as { demo_sandbox_id?: string | null } | null)?.demo_sandbox_id) return 0;
    const ids = Array.from(new Set(items.map((i) => i.profileId)));
    const { data: subs, error } = await db
      .from("push_subscriptions")
      .select("id,profile_id,endpoint,p256dh,auth_secret,failure_count")
      .eq("org_id", orgId)
      .in("profile_id", ids);
    if (error) {
      logError("push.load", error);
      return 0;
    }
    for (const item of items) {
      const payload = buildPushPayload(item);
      for (const s of (subs ?? []).filter((x) => x.profile_id === item.profileId)) {
        try {
          const res = await sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth_secret }, payload, keys, {
            urgency: item.urgent ? "high" : "normal",
            topic: item.tag,
          });
          if (res.ok) {
            sent += 1;
            await db.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", s.id).eq("org_id", orgId);
          } else if (res.gone || s.failure_count >= 4) {
            await db.from("push_subscriptions").delete().eq("id", s.id).eq("org_id", orgId);
          } else {
            await db.from("push_subscriptions").update({ failure_count: s.failure_count + 1 }).eq("id", s.id).eq("org_id", orgId);
          }
        } catch (e) {
          logError("push.send", e);
        }
      }
    }
  } catch (e) {
    logError("push.deliver", e);
  }
  return sent;
}

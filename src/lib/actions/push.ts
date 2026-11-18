"use server";

import { familyDb } from "@/lib/family/db";
import { audit, fail, failDb, ok, requireMember, type FamilyResult } from "@/lib/family/action-helpers";
import { pushSubscriptionSchema, type PushSubscriptionInput } from "@/lib/family/validation";
import { deliverPush, pushConfigured } from "@/lib/push/send";
import { getTranslations } from "@/lib/i18n/server";
import { z } from "zod";

/**
 * Register this device for Web Push in the current club (own rows only, RLS).
 * Re-registering the same endpoint refreshes its keys.
 */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  if (!pushConfigured()) return fail("pushNotConfigured");
  const p = pushSubscriptionSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const db = await familyDb();
  const { error } = await db.from("push_subscriptions").upsert(
    {
      org_id: me.orgId, profile_id: me.id, endpoint: p.data.endpoint, p256dh: p.data.keys.p256dh, auth_secret: p.data.keys.auth,
      user_agent: p.data.userAgent?.slice(0, 300) ?? null, failure_count: 0,
    },
    { onConflict: "org_id,endpoint" },
  );
  if (error) return failDb("family.push.save", error);
  await audit(me, "push.subscribed", "push_subscriptions", null);
  return ok("family.messages.pushOn");
}

/** Unregister this device (the browser subscription is removed client-side). */
export async function removePushSubscription(endpoint: string): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  if (!z.string().url().max(1000).safeParse(endpoint).success) return fail("invalid");
  const db = await familyDb();
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("profile_id", me.id).eq("org_id", me.orgId);
  if (error) return failDb("family.push.remove", error);
  await audit(me, "push.unsubscribed", "push_subscriptions", null);
  return ok("family.messages.pushOff");
}

/** Sends a test notification to the caller's own devices in this club. */
export async function sendTestPush(): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  if (!pushConfigured()) return fail("pushNotConfigured");
  const t = await getTranslations();
  const sent = await deliverPush(me.orgId, [{ profileId: me.id, title: t("family.push.test.title"), body: t("family.push.test.body"), path: "/", tag: "test" }]);
  return sent > 0 ? ok("family.messages.pushTestSent") : fail("pushNoDevice");
}

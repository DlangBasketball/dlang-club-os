import "server-only";
import { generateSecret, secretHint } from "./hmac";
import { openSecret, sealSecret } from "./secret-box";
import { websiteDb, type WebsiteDb } from "./server";

/**
 * Webhook signing secret of a club. Stored in public.website_secrets, which
 * only the service role can read (no RLS policy lets any app user, admins
 * included, read or write it); sealed with AES-256-GCM when WEBSITE_SECRET_KEY
 * is set. The plaintext leaves the server exactly once: in the result of the
 * admin's "generate / rotate" action.
 */
const keyMaterial = () => process.env.WEBSITE_SECRET_KEY ?? null;

export async function getWebsiteSecret(orgId: string, db: WebsiteDb = websiteDb()): Promise<string | null> {
  const { data } = await db.from("website_secrets").select("secret_enc").eq("org_id", orgId).maybeSingle();
  return openSecret((data as { secret_enc?: string } | null)?.secret_enc ?? null, keyMaterial());
}

/** Generate + store a new secret; returns the plaintext (show once) and its hint. */
export async function rotateWebsiteSecret(orgId: string, db: WebsiteDb = websiteDb()): Promise<{ secret: string; hint: string } | null> {
  const secret = generateSecret();
  const sealed = sealSecret(secret, keyMaterial());
  const { error } = await db.from("website_secrets").upsert({ org_id: orgId, secret_enc: sealed }, { onConflict: "org_id" });
  if (error) return null;
  const hint = secretHint(secret);
  await db.from("website_settings").upsert({ org_id: orgId, secret_hint: hint, secret_set_at: new Date().toISOString() }, { onConflict: "org_id" });
  return { secret, hint };
}

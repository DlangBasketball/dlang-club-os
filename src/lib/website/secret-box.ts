import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * At-rest protection of the webhook signing secret (website_secrets, which
 * only the service role can read). When WEBSITE_SECRET_KEY is set the secret
 * is sealed with AES-256-GCM ("v1:" values); without it the value is stored
 * as "plain:" (still service-role only). Pure: the key is passed in.
 */

function keyFrom(material: string): Buffer {
  return createHash("sha256").update(material, "utf8").digest();
}

export function sealSecret(secret: string, keyMaterial: string | null | undefined): string {
  if (!keyMaterial || keyMaterial.length < 16) return `plain:${secret}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyMaterial), iv);
  const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Null when the value cannot be opened (wrong / missing key, tampered). */
export function openSecret(stored: string | null | undefined, keyMaterial: string | null | undefined): string | null {
  if (!stored) return null;
  if (stored.startsWith("plain:")) return stored.slice(6) || null;
  if (!stored.startsWith("v1:") || !keyMaterial || keyMaterial.length < 16) return null;
  const [, iv, tag, ct] = stored.split(":");
  if (!iv || !tag || !ct) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyMaterial), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

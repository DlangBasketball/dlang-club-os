import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resend webhooks (Svix signing): verify the signature and read the delivery
 * outcome of one e-mail. Pure, no I/O (unit-tested).
 *
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   signature      = base64(HMAC-SHA256(base64-decode(secret without "whsec_"), content))
 *   header         = "v1,<sig> v1,<sig2>" (any match passes)
 */
export function verifySvixSignature(args: {
  secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; nowSeconds?: number; toleranceSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signature, body } = args;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (args.toleranceSeconds ?? 300)) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export type DeliveryOutcome =
  | { kind: "failed"; providerId: string; orgId: string | null; error: string }
  | { kind: "delivered"; providerId: string; orgId: string | null }
  | { kind: "ignored" };

const FAILED_TYPES: Record<string, string> = { "email.bounced": "bounced", "email.complained": "complained", "email.failed": "failed" };

/** The outcome a Resend event reports, or "ignored". */
export function deliveryOutcome(payload: unknown): DeliveryOutcome {
  if (!payload || typeof payload !== "object") return { kind: "ignored" };
  const p = payload as { type?: unknown; data?: Record<string, unknown> };
  const type = typeof p.type === "string" ? p.type : "";
  const data = p.data ?? {};
  const providerId = typeof data.email_id === "string" ? data.email_id : "";
  if (!providerId) return { kind: "ignored" };
  const orgId = tagValue(data.tags, "org");
  if (type === "email.delivered") return { kind: "delivered", providerId, orgId };
  const label = FAILED_TYPES[type];
  if (!label) return { kind: "ignored" };
  const bounce = (data.bounce ?? data.failed ?? null) as { message?: unknown; type?: unknown; subType?: unknown; reason?: unknown } | null;
  const detail = [bounce?.type, bounce?.subType, bounce?.message ?? bounce?.reason].filter((x) => typeof x === "string" && x).join(" / ");
  return { kind: "failed", providerId, orgId, error: (detail ? `${label}: ${detail}` : label).slice(0, 300) };
}

/** Tag value from either `{ name: value }` or `[{ name, value }]`. */
function tagValue(tags: unknown, name: string): string | null {
  if (Array.isArray(tags)) {
    const hit = tags.find((t) => t && typeof t === "object" && (t as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof hit?.value === "string" ? hit.value : null;
  }
  if (tags && typeof tags === "object") {
    const v = (tags as Record<string, unknown>)[name];
    return typeof v === "string" ? v : null;
  }
  return null;
}

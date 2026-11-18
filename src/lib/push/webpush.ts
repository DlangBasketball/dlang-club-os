import { createECDH, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign, createCipheriv, type KeyObject } from "node:crypto";

/**
 * Minimal Web Push (no third-party SDK):
 *   - VAPID (RFC 8292): an ES256 JWT signed with the server's P-256 key.
 *   - Message encryption (RFC 8291, "aes128gcm" content coding, RFC 8188).
 * Server-only (node:crypto). Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
 * (base64url, uncompressed P-256 public point / 32-byte private scalar) and
 * VAPID_SUBJECT (mailto: or https: contact for the push services).
 */

export function b64urlEncode(buf: Uint8Array | Buffer): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Buffer {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(norm + "=".repeat((4 - (norm.length % 4)) % 4), "base64");
}

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

/** VAPID settings from the environment, or null when push is not configured. */
export function vapidFromEnv(env: Record<string, string | undefined> = process.env): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:)/.test(subject)) return null;
  try {
    if (b64urlDecode(publicKey).length !== 65 || b64urlDecode(privateKey).length !== 32) return null;
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}

/** Fresh VAPID key pair (used by scripts/generate-vapid-keys.mjs and tests). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64urlEncode(ecdh.getPublicKey()), privateKey: b64urlEncode(ecdh.getPrivateKey()) };
}

function privateKeyObject(keys: { publicKey: string; privateKey: string }): KeyObject {
  const pub = b64urlDecode(keys.publicKey);
  return createPrivateKey({
    key: {
      kty: "EC", crv: "P-256",
      d: keys.privateKey,
      x: b64urlEncode(pub.subarray(1, 33)),
      y: b64urlEncode(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
}

/** Public key object for an uncompressed P-256 point (verification in tests). */
export function publicKeyObject(publicKey: string): KeyObject {
  const pub = b64urlDecode(publicKey);
  return createPublicKey({
    key: { kty: "EC", crv: "P-256", x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33, 65)) },
    format: "jwk",
  });
}

/** Signed VAPID JWT for one push service origin (valid 12 h). */
export function vapidJwt(audience: string, keys: VapidKeys, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(Buffer.from(JSON.stringify({ aud: audience, exp: nowSeconds + 12 * 3600, sub: keys.subject })));
  const input = `${header}.${claims}`;
  const sig = sign("sha256", Buffer.from(input), { key: privateKeyObject(keys), dsaEncoding: "ieee-p1363" });
  return `${input}.${b64urlEncode(sig)}`;
}

/** Authorization header value ("vapid t=<jwt>, k=<public key>"). */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSeconds?: number): string {
  const aud = new URL(endpoint).origin;
  return `vapid t=${vapidJwt(aud, keys, nowSeconds)}, k=${keys.publicKey}`;
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

export type Subscription = { endpoint: string; p256dh: string; auth: string };

/**
 * Encrypts a payload for one subscription (RFC 8291 / aes128gcm, one record).
 * `ephemeral` and `salt` are injectable for deterministic tests only.
 */
export function encryptPayload(
  sub: Pick<Subscription, "p256dh" | "auth">,
  payload: Buffer | string,
  opts: { ephemeralPrivateKey?: Buffer; salt?: Buffer } = {},
): Buffer {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("INVALID_SUBSCRIPTION_KEYS");

  const ecdh = createECDH("prime256v1");
  if (opts.ephemeralPrivateKey) ecdh.setPrivateKey(opts.ephemeralPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const salt = opts.salt ?? randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const plain = Buffer.concat([Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8"), Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export type PushResult = { ok: true } | { ok: false; status: number; gone: boolean };

/** POSTs one encrypted message to the push service. */
export async function sendWebPush(
  sub: Subscription,
  payload: string,
  keys: VapidKeys,
  opts: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string; fetchImpl?: typeof fetch } = {},
): Promise<PushResult> {
  const body = encryptPayload(sub, payload);
  const headers: Record<string, string> = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttlSeconds ?? 24 * 3600),
    Urgency: opts.urgency ?? "normal",
    Authorization: vapidAuthorization(sub.endpoint, keys),
  };
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await (opts.fetchImpl ?? fetch)(sub.endpoint, { method: "POST", headers, body: new Uint8Array(body) });
  if (res.status >= 200 && res.status < 300) return { ok: true };
  return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410 };
}

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Server-side fetch of a club-configured URL (website importer, webhook
 * delivery) with SSRF protection:
 *   - https only, default port only, no credentials in the URL
 *   - the host must not be localhost / *.local / *.internal, and EVERY
 *     address it resolves to must be public (no loopback, private, link-local,
 *     CGNAT, multicast, reserved or IPv4-mapped private IPv6)
 *   - redirects are followed manually (max 3) and re-checked each hop
 *   - timeout and a hard response-size limit
 * Residual risk: DNS rebinding between the check and the connection; the
 * window is one lookup and the response is only parsed as JSON.
 */

export type LookupFn = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true, verbatim: true });

export class UnsafeUrlError extends Error {
  constructor(public readonly reason: string) {
    super(`unsafe_url:${reason}`);
    this.name = "UnsafeUrlError";
  }
}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

function inV4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base!) & mask);
}

const PRIVATE_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24",
  "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
];

/** Expand an IPv6 address to 8 groups of 16 bits (null when malformed). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // Embedded IPv4 tail (::ffff:1.2.3.4)
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = v4ToInt(v4[1]!);
    s = s.slice(0, -v4[1]!.length) + `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const all = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail];
  if (all.length !== 8) return null;
  const out = all.map((g) => parseInt(g, 16));
  return out.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff) ? null : out;
}

/** True for any address a server-side request must never reach. */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return PRIVATE_V4.some((c) => inV4(ip, c));
  if (kind !== 6) return true; // not an IP: refuse
  const g = v6Groups(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible / NAT64 (64:ff9b::/96): check the IPv4 part.
  const v4tail = `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateIp(v4tail);
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIp(v4tail);
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g[0]! & 0xffc0) === 0xfec0) return true; // fec0::/10 site local (deprecated)
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

const BLOCKED_HOST_RE = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i;

/** Parse + statically validate a URL (no DNS). Throws UnsafeUrlError. */
export function assertSafeUrlShape(input: string): URL {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new UnsafeUrlError("invalid");
  }
  if (u.protocol !== "https:") throw new UnsafeUrlError("https_only");
  if (u.username || u.password) throw new UnsafeUrlError("credentials");
  if (u.port && u.port !== "443") throw new UnsafeUrlError("port");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOST_RE.test(host)) throw new UnsafeUrlError("host");
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("private_ip");
  } else if (!host.includes(".")) {
    throw new UnsafeUrlError("host");
  }
  return u;
}

/** Validate shape AND every resolved address. Throws UnsafeUrlError. */
export async function assertPublicUrl(input: string, lookup: LookupFn = defaultLookup): Promise<URL> {
  const u = assertSafeUrlShape(input);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return u;
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host);
  } catch {
    throw new UnsafeUrlError("dns");
  }
  if (!addrs.length) throw new UnsafeUrlError("dns");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError("private_ip");
  return u;
}

export type SafeFetchOptions = {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  lookup?: LookupFn;
  fetchImpl?: typeof fetch;
};

export type SafeResponse = { status: number; ok: boolean; headers: Headers; url: string; bytes: Uint8Array; text: () => string };

export class ResponseTooLargeError extends Error {
  constructor() {
    super("response_too_large");
    this.name = "ResponseTooLargeError";
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ResponseTooLargeError();
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  let url = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertPublicUrl(url, opts.lookup);
    const res = await doFetch(u.toString(), {
      method: opts.method ?? "GET",
      headers: { "User-Agent": "ClubOS-Website-Connect/1.0", ...(opts.headers ?? {}) },
      body: opts.body,
      redirect: "manual",
      signal,
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (opts.method === "POST") throw new UnsafeUrlError("redirect_on_post");
      url = new URL(res.headers.get("location")!, u).toString();
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    const bytes = await readLimited(res, maxBytes);
    return { status: res.status, ok: res.ok, headers: res.headers, url: u.toString(), bytes, text: () => new TextDecoder().decode(bytes) };
  }
  throw new UnsafeUrlError("too_many_redirects");
}

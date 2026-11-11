import "server-only";
import { resolveTxt } from "node:dns/promises";

/**
 * Custom-domain ownership check. The tenant adds a DNS TXT record
 *   _clubos-verify.<domain>  TXT  "clubos-verify=<verification_token>"
 * and points the domain (CNAME) at the platform host. Routing traffic for a
 * verified domain is the hosting layer's job (e.g. Vercel domains API).
 */
export const VERIFY_PREFIX = "_clubos-verify";

export function verificationRecord(domain: string, token: string) {
  return { host: `${VERIFY_PREFIX}.${domain}`, value: `clubos-verify=${token}` };
}

export async function checkDomainTxt(domain: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const { host, value } = verificationRecord(domain, token);
  try {
    const records = await resolveTxt(host);
    const flat = records.map((chunks) => chunks.join(""));
    return flat.includes(value) ? { ok: true } : { ok: false, error: `TXT record found but no "${value}"` };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return { ok: false, error: code === "ENOTFOUND" || code === "ENODATA" ? `No TXT record at ${host}` : `DNS lookup failed (${code ?? "error"})` };
  }
}

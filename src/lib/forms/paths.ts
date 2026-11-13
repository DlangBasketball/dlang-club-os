import { createHmac, randomUUID } from "node:crypto";

/**
 * Storage keys and evidence hashing for forms and contracts (pure).
 * Buckets "form-files" and "contracts" are private; keys are
 * <org_id>/<family_id>/<file> so Storage RLS (forms_storage_access) can
 * decide from the key alone.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FILE_RE = new RegExp(`^${UUID}/${UUID}/${UUID}\\.(pdf|png|jpg|jpeg|webp|heic)$`);

export const UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
};
/** Server actions accept 3 MB bodies (next.config.mjs); keep uploads below that. */
export const MAX_UPLOAD_BYTES = 2.5 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 300 * 1024;

export function formFilePath(orgId: string, familyId: string, ext: string, id: string = randomUUID()): string {
  return `${orgId}/${familyId}/${id}.${ext}`;
}

/** True when `path` is a form-files key of this org and family. */
export function isFormFilePathFor(path: string, orgId: string, familyId: string): boolean {
  return FILE_RE.test(path) && path.startsWith(`${orgId}/${familyId}/`);
}

export function contractPdfPath(orgId: string, familyId: string, contractId: string): string {
  return `${orgId}/${familyId}/${contractId}.pdf`;
}

/**
 * Keyed hash of the signer's IP address: proves "same network" if ever
 * needed without storing the address. Keyed per org with a server secret.
 */
export function hashIp(ip: string | null, orgId: string, pepper: string): string | null {
  const v = (ip ?? "").trim();
  if (!v) return null;
  return createHmac("sha256", pepper || "ip-hash").update(`${orgId}|${v}`).digest("hex");
}

/** First address of an X-Forwarded-For header. */
export function firstForwardedIp(header: string | null): string | null {
  const v = (header ?? "").split(",")[0]?.trim();
  return v ? v : null;
}

/** "data:image/png;base64,...." -> bytes (PNG only, size-capped). */
export function decodePngDataUrl(dataUrl: string, maxBytes = MAX_SIGNATURE_BYTES): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Uint8Array.from(Buffer.from(m[1], "base64"));
  if (bytes.length === 0 || bytes.length > maxBytes) return null;
  // PNG signature
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => bytes[i] === b) ? bytes : null;
}

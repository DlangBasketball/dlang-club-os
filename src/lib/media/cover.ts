import { z } from "zod";

/**
 * Covers & media library: shared constants and pure helpers (browser + server).
 *
 * Storage layout
 *   club-media (PUBLIC)      <org_id>/<covers|banners|gallery>/<random>.<ext>
 *                            club library (media_assets); org / team /
 *                            programme / camp covers point at these paths
 *   athlete-covers (PRIVATE) <org_id>/<athlete_id>/<random>.<ext>
 *                            player-profile banners, signed URLs only
 */

export const CLUB_MEDIA_BUCKET = "club-media";
export const ATHLETE_COVER_BUCKET = "athlete-covers";

/** Longest side after the browser resize. */
export const COVER_MAX_WIDTH = 2400;
export const COVER_MAX_HEIGHT = 2400;
/** Upload limit after resize (the buckets allow the same). */
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
/** Source files above this are refused before decoding (protects the tab). */
export const COVER_MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export const COVER_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type CoverType = (typeof COVER_TYPES)[number];
/** What the file picker offers. */
export const COVER_INPUT_ACCEPT = "image/jpeg,image/png,image/webp";
/** Encoder preference and quality ladder for the resize. */
export const COVER_ENCODE_TYPES = ["image/webp", "image/jpeg"] as const;
export const COVER_QUALITY_STEPS = [0.86, 0.78, 0.7, 0.6, 0.5] as const;
/** Signed URLs of private athlete covers live this long (seconds). */
export const COVER_URL_TTL = 600;
/** Library upload batch size. */
export const MEDIA_MAX_BATCH = 12;

export const MEDIA_KINDS = ["cover", "banner", "gallery"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
const KIND_FOLDER: Record<MediaKind, string> = { cover: "covers", banner: "banners", gallery: "gallery" };

/**
 * Records that can carry a cover. 'program' and 'camp_edition' work as soon as
 * their tables have cover_path / cover_focal_x / cover_focal_y (camps
 * migration); until then set_cover() answers COVER_TARGET_UNSUPPORTED.
 */
export const COVER_TARGETS = ["org", "team", "athlete", "program", "camp_edition"] as const;
export type CoverTarget = (typeof COVER_TARGETS)[number];
/** Surfaces anyone can see: a library image there needs the consent confirmation. */
export const PUBLIC_COVER_TARGETS: readonly CoverTarget[] = ["org", "program", "camp_edition"];
export function isPublicCoverTarget(target: CoverTarget): boolean {
  return PUBLIC_COVER_TARGETS.includes(target);
}

export type Focal = { x: number; y: number };
export const DEFAULT_FOCAL: Focal = { x: 50, y: 50 };

/** What a page passes to <CoverImage>: a ready-to-use URL plus the focal point. */
export type CoverView = { url: string | null; focalX: number; focalY: number; path: string | null };

// ---------------------------------------------------------------------------
// Focal point
// ---------------------------------------------------------------------------

/** Clamp to an integer percentage 0..100 (NaN / missing -> 50). */
export function clampFocal(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 50;
  return Math.min(100, Math.max(0, Math.round(v)));
}

/** CSS object-position for a stored focal point. */
export function objectPosition(x: number | null | undefined, y: number | null | undefined): string {
  return `${clampFocal(x)}% ${clampFocal(y)}%`;
}

/**
 * Focal point from a click on the preview: the click position relative to the
 * element box, as integer percentages (clamped to the box).
 */
export function focalFromPoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): Focal {
  if (!(rect.width > 0) || !(rect.height > 0)) return { ...DEFAULT_FOCAL };
  return {
    x: clampFocal(((clientX - rect.left) / rect.width) * 100),
    y: clampFocal(((clientY - rect.top) / rect.height) * 100),
  };
}

/** Nudge with the keyboard (arrow keys move the point by `step` percent). */
export function nudgeFocal(f: Focal, key: string, step = 5): Focal {
  switch (key) {
    case "ArrowLeft": return { x: clampFocal(f.x - step), y: f.y };
    case "ArrowRight": return { x: clampFocal(f.x + step), y: f.y };
    case "ArrowUp": return { x: f.x, y: clampFocal(f.y - step) };
    case "ArrowDown": return { x: f.x, y: clampFocal(f.y + step) };
    default: return f;
  }
}

// ---------------------------------------------------------------------------
// Resize parameters
// ---------------------------------------------------------------------------

/**
 * Target size for a cover: fit inside COVER_MAX_WIDTH x COVER_MAX_HEIGHT,
 * never upscale, integer pixels. Returns 0x0 for an undecodable size.
 */
export function coverResizeParams(
  width: number,
  height: number,
  maxWidth = COVER_MAX_WIDTH,
  maxHeight = COVER_MAX_HEIGHT,
): { width: number; height: number; scale: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: 0, height: 0, scale: 0 };
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

export function isAllowedCoverType(type: string | null | undefined): type is CoverType {
  return !!type && (COVER_TYPES as readonly string[]).includes(type);
}

/** Validate an (already resized) cover file. Returns an i18n key or null. */
export function checkCoverFile(file: { size: number; type: string } | null | undefined): string | null {
  if (!file || file.size === 0) return "media.errors.noFile";
  if (!isAllowedCoverType(file.type)) return "media.errors.type";
  if (file.size > COVER_MAX_BYTES) return "media.errors.size";
  return null;
}

/** Recognise the image by its first bytes (never trust the declared type alone). */
export function sniffCoverType(bytes: Uint8Array): CoverType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;
const EXT: Record<CoverType, string> = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };

function safeRandom(random: string): string {
  return random.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "cover";
}

/** Library key: <org_id>/<covers|banners|gallery>/<random>.<ext>. */
export function libraryObjectPath(orgId: string, kind: MediaKind, type: CoverType, random: string): string {
  if (!UUID_RE.test(orgId)) throw new Error("invalid org id");
  return `${orgId}/${KIND_FOLDER[kind]}/${safeRandom(random)}.${EXT[type]}`;
}

/** Private athlete cover key: <org_id>/<athlete_id>/<random>.<ext>. */
export function athleteCoverObjectPath(orgId: string, athleteId: string, type: CoverType, random: string): string {
  if (!UUID_RE.test(orgId) || !UUID_RE.test(athleteId)) throw new Error("invalid id");
  return `${orgId}/${athleteId}/${safeRandom(random)}.${EXT[type]}`;
}

/** Mirrors media_is_library_path() in SQL. */
export function isLibraryPath(path: string | null | undefined, orgId: string): boolean {
  if (!path || path.includes("..")) return false;
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === orgId && ["covers", "banners", "gallery"].includes(parts[1]) && FILE_RE.test(parts[2]);
}

/** Mirrors media_is_athlete_cover_path() in SQL. */
export function isAthleteCoverPath(path: string | null | undefined, orgId: string, athleteId: string): boolean {
  if (!path || path.includes("..")) return false;
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === orgId && parts[1] === athleteId && FILE_RE.test(parts[2]);
}

// ---------------------------------------------------------------------------
// Action inputs
// ---------------------------------------------------------------------------

const focalNumber = z.coerce.number().finite().transform((v) => clampFocal(v));

/**
 * setCover() input (FormData fields of the same names):
 *   mode 'asset'  : assetId of a club library image
 *   mode 'upload' : file (+ optional alt, width, height)
 *   mode 'focal'  : keep the current image, change the focal point
 *   mode 'remove' : clear the cover
 * publicConsent must be "true" to put a library image on a public surface.
 */
export const setCoverSchema = z.object({
  target: z.enum(COVER_TARGETS),
  id: z.string().uuid(),
  mode: z.enum(["asset", "upload", "focal", "remove"]),
  assetId: z.string().uuid().optional(),
  focalX: focalNumber.default(50),
  focalY: focalNumber.default(50),
  publicConsent: z.boolean().default(false),
  alt: z.string().trim().max(300).optional(),
  width: z.coerce.number().int().min(1).max(10000).optional(),
  height: z.coerce.number().int().min(1).max(10000).optional(),
});
export type SetCoverInput = z.input<typeof setCoverSchema>;

/** Build the FormData setCover() expects (client helper). */
export function coverFormData(input: SetCoverInput & { file?: File | Blob | null }): FormData {
  const fd = new FormData();
  fd.set("target", input.target);
  fd.set("id", input.id);
  fd.set("mode", input.mode);
  if (input.assetId) fd.set("assetId", input.assetId);
  fd.set("focalX", String(input.focalX ?? 50));
  fd.set("focalY", String(input.focalY ?? 50));
  fd.set("publicConsent", input.publicConsent ? "true" : "false");
  if (input.alt) fd.set("alt", input.alt);
  if (input.width) fd.set("width", String(input.width));
  if (input.height) fd.set("height", String(input.height));
  if (input.file) fd.set("file", input.file);
  return fd;
}

export const mediaAssetUpdateSchema = z.object({
  id: z.string().uuid(),
  altText: z.string().trim().max(300).optional().transform((v) => (v ? v : null)),
  consentNote: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
  kind: z.enum(MEDIA_KINDS).optional(),
});
export type MediaAssetUpdateInput = z.input<typeof mediaAssetUpdateSchema>;

/** Public URL of a club-media object (library images are public by design). */
export function clubMediaPublicUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${CLUB_MEDIA_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Map a set_cover() / storage error message to an i18n key. */
export function coverErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("CONSENT_REQUIRED")) return "media.errors.consentRequired";
  if (m.includes("COVER_TARGET_UNSUPPORTED")) return "media.errors.unsupported";
  if (m.includes("NOT_FOUND")) return "media.errors.notFound";
  if (m.includes("INVALID_PATH")) return "media.errors.invalidPath";
  if (m.includes("MEDIA_IN_USE")) return "media.errors.inUse";
  if (m.includes("NOT_AUTHORIZED") || m.includes("row-level security") || m.includes("permission denied")) return "media.errors.forbidden";
  return "media.errors.generic";
}

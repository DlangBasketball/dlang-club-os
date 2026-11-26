"use client";

import {
  COVER_ENCODE_TYPES,
  COVER_MAX_BYTES,
  COVER_MAX_SOURCE_BYTES,
  COVER_QUALITY_STEPS,
  coverResizeParams,
  isAllowedCoverType,
} from "./cover";

export type ResizedCover = { file: File; width: number; height: number };

/**
 * Browser-side resize + re-encode of a cover before upload: at most 2400 px
 * on the long side, WebP (JPEG where the browser cannot encode WebP), the
 * quality stepped down until the file fits COVER_MAX_BYTES. Drawing through a
 * canvas drops all EXIF / XMP metadata (GPS position, device, owner) from the
 * original. Only JPEG / PNG / WebP sources are accepted. Returns an i18n key
 * on failure.
 */
export async function resizeCover(file: File): Promise<ResizedCover | { error: string }> {
  if (!isAllowedCoverType(file.type)) return { error: "media.errors.type" };
  if (file.size > COVER_MAX_SOURCE_BYTES) return { error: "media.errors.sourceTooLarge" };
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = typeof createImageBitmap === "function"
      ? await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions)
      : await loadImage(file);
  } catch {
    return { error: "media.errors.decode" };
  }
  const { width, height } = coverResizeParams(bitmap.width, bitmap.height);
  if (!width || !height) return { error: "media.errors.decode" };

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { error: "media.errors.decode" };
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  for (const type of COVER_ENCODE_TYPES) {
    for (const quality of COVER_QUALITY_STEPS) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      if (!blob || blob.type !== type) break; // encoder not supported: next type
      if (blob.size <= COVER_MAX_BYTES) {
        const ext = type === "image/webp" ? "webp" : "jpg";
        return { file: new File([blob], `cover.${ext}`, { type }), width, height };
      }
    }
  }
  return { error: "media.errors.size" };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

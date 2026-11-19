"use client";

import { PHOTO_MAX_BYTES, PHOTO_MAX_DIMENSION, fitWithin } from "./validation";

/**
 * Browser-side resize + re-encode of a photo before upload: max 800 px on the
 * long side, WebP (JPEG where the browser cannot encode WebP), stepping the
 * quality down until it fits PHOTO_MAX_BYTES. Re-encoding through a canvas
 * also drops EXIF metadata (GPS location, device) from the original file.
 * Returns an i18n error key on failure.
 */
export async function resizePhoto(file: File): Promise<{ file: File } | { error: string }> {
  if (!file.type.startsWith("image/")) return { error: "athletePhoto.errors.type" };
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = typeof createImageBitmap === "function"
      ? await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions)
      : await loadImage(file);
  } catch {
    return { error: "athletePhoto.errors.decode" };
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_DIMENSION);
  if (!width || !height) return { error: "athletePhoto.errors.decode" };

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { error: "athletePhoto.errors.decode" };
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  for (const type of ["image/webp", "image/jpeg"] as const) {
    for (const quality of [0.85, 0.75, 0.65, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      if (!blob || blob.type !== type) break; // encoder not supported: try the next type
      if (blob.size <= PHOTO_MAX_BYTES) {
        const ext = type === "image/webp" ? "webp" : "jpg";
        return { file: new File([blob], `photo.${ext}`, { type }) };
      }
    }
  }
  return { error: "athletePhoto.errors.size" };
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

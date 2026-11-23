/**
 * Photo crop maths (pure): an image shown "cover" inside a fixed frame,
 * zoomed and panned by the user. The frame defines the crop; the result is
 * the source rectangle to draw on a canvas. Used by the crop dialog before
 * the existing resize-before-upload step.
 */

export type CropAspect = "square" | "portrait";
/** width / height of the crop frame. Portrait matches the card's photo frame (4:5). */
export const CROP_RATIO: Record<CropAspect, number> = { square: 1, portrait: 4 / 5 };
export const CROP_MIN_ZOOM = 1;
export const CROP_MAX_ZOOM = 4;

export type Size = { width: number; height: number };
export type Offset = { x: number; y: number };
export type Rect = { sx: number; sy: number; sw: number; sh: number };

/** Frame size for a ratio inside a box of `maxWidth` x `maxHeight`. */
export function frameSize(ratio: number, maxWidth: number, maxHeight: number): Size {
  const w = Math.min(maxWidth, maxHeight * ratio);
  return { width: Math.round(w), height: Math.round(w / ratio) };
}

/** Scale (display px per source px) at a zoom level: zoom 1 = the image just covers the frame. */
export function scaleFor(image: Size, frame: Size, zoom: number): number {
  const cover = Math.max(frame.width / image.width, frame.height / image.height);
  return cover * clampZoom(zoom);
}

export function clampZoom(zoom: number): number {
  return Math.min(CROP_MAX_ZOOM, Math.max(CROP_MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1));
}

/** Keep the image covering the frame: offset = image top-left relative to the frame (<= 0). */
export function clampOffset(offset: Offset, image: Size, frame: Size, zoom: number): Offset {
  const s = scaleFor(image, frame, zoom);
  const minX = frame.width - image.width * s;
  const minY = frame.height - image.height * s;
  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  };
}

/** Centred offset at a zoom level. */
export function centredOffset(image: Size, frame: Size, zoom: number): Offset {
  const s = scaleFor(image, frame, zoom);
  return { x: (frame.width - image.width * s) / 2, y: (frame.height - image.height * s) / 2 };
}

/**
 * Zoom around the frame centre: the point under the centre stays there.
 */
export function zoomAround(offset: Offset, image: Size, frame: Size, fromZoom: number, toZoom: number): Offset {
  const s0 = scaleFor(image, frame, fromZoom);
  const s1 = scaleFor(image, frame, toZoom);
  const cx = (frame.width / 2 - offset.x) / s0;
  const cy = (frame.height / 2 - offset.y) / s0;
  return clampOffset({ x: frame.width / 2 - cx * s1, y: frame.height / 2 - cy * s1 }, image, frame, toZoom);
}

/** Source rectangle (in image pixels) currently inside the frame. */
export function cropRect(image: Size, frame: Size, zoom: number, offset: Offset): Rect {
  const s = scaleFor(image, frame, zoom);
  const o = clampOffset(offset, image, frame, zoom);
  const sw = Math.min(image.width, frame.width / s);
  const sh = Math.min(image.height, frame.height / s);
  const sx = Math.min(image.width - sw, Math.max(0, -o.x / s));
  const sy = Math.min(image.height - sh, Math.max(0, -o.y / s));
  return { sx, sy, sw, sh };
}

/** Output canvas size for a crop: the crop's own size, capped on the long side. */
export function outputSize(rect: Rect, maxSide: number): Size {
  const k = Math.min(1, maxSide / Math.max(rect.sw, rect.sh));
  return { width: Math.max(1, Math.round(rect.sw * k)), height: Math.max(1, Math.round(rect.sh * k)) };
}

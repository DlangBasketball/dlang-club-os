"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import {
  CROP_MAX_ZOOM, CROP_MIN_ZOOM, CROP_RATIO, centredOffset, clampOffset, clampZoom, cropRect, frameSize, outputSize, scaleFor, zoomAround,
  type CropAspect, type Offset, type Size,
} from "@/lib/people/crop";
import { cn } from "@/lib/utils";

/** Long side of the cropped image handed to the resize step (which caps at 800 px). */
const CROP_OUTPUT_MAX = 1600;

/**
 * Preview + crop before upload: square or portrait (4:5, the card frame)
 * frame, drag (or arrow keys) to move, slider to zoom. The crop is drawn on a
 * canvas in the browser; the caller then runs the existing resize step, so
 * EXIF metadata is dropped and the server re-checks type and size.
 */
export function PhotoCropDialog({ file, onCancel, onConfirm, defaultAspect = "portrait" }: {
  file: File | null;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
  defaultAspect?: CropAspect;
}) {
  const t = useT();
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [aspect, setAspect] = React.useState<CropAspect>(defaultAspect);
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState<Offset>({ x: 0, y: 0 });
  const [busy, setBusy] = React.useState(false);
  const drag = React.useRef<{ id: number; x: number; y: number; start: Offset } | null>(null);

  const frame: Size = frameSize(CROP_RATIO[aspect], 300, 340);
  const image: Size | null = img ? { width: img.naturalWidth, height: img.naturalHeight } : null;

  // Load the picked file into an <img> (object URL, revoked on close).
  React.useEffect(() => {
    setImg(null); setFailed(false); setZoom(1);
    if (!file) { setUrl(null); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setFailed(true);
    el.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  React.useEffect(() => {
    if (image) setOffset(centredOffset(image, frame, zoom));
    // re-centre when the image or the frame shape changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, aspect]);

  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (file && !d.open) d.showModal();
    if (!file && d.open) d.close();
  }, [file]);

  const move = (dx: number, dy: number) => {
    if (!image) return;
    setOffset((o) => clampOffset({ x: o.x + dx, y: o.y + dy }, image, frame, zoom));
  };
  const setZoomTo = (z: number) => {
    if (!image) return;
    const next = clampZoom(z);
    setOffset((o) => zoomAround(o, image, frame, zoom, next));
    setZoom(next);
  };

  async function confirm() {
    if (!img || !image || !file) return;
    setBusy(true);
    try {
      const rect = cropRect(image, frame, zoom, offset);
      const out = outputSize(rect, CROP_OUTPUT_MAX);
      const canvas = document.createElement("canvas");
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, out.width, out.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("encode failed");
      onConfirm(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const s = image ? scaleFor(image, frame, zoom) : 1;

  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onCancel} onCancel={(e) => { e.preventDefault(); onCancel(); }}
      className="m-0 mt-auto w-full max-w-none rounded-t-lg border border-border bg-surface p-0 text-text shadow-xl backdrop:bg-black/60 sm:m-auto sm:w-[min(26rem,calc(100vw-2rem))] sm:rounded-lg">
      {file && (
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="font-display text-lg">{t("memberCard.crop.title")}</h2>
            <button type="button" onClick={onCancel} aria-label={t("memberCard.close")}
              className="-m-2 flex h-10 w-10 items-center justify-center rounded text-text-muted hover:text-text">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div role="radiogroup" aria-label={t("memberCard.crop.shape")} className="flex gap-1 rounded-lg border border-border bg-surface-elevated p-1">
            {(["portrait", "square"] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={aspect === a} onClick={() => setAspect(a)}
                className={cn("flex-1 rounded-md px-3 py-1.5 text-sm", aspect === a ? "bg-brand-primary text-on-brand" : "text-text-muted hover:text-text")}>
                {t(`memberCard.crop.${a}`)}
              </button>
            ))}
          </div>

          <div className="flex justify-center">
            <div
              tabIndex={0}
              role="application"
              aria-label={t("memberCard.crop.frameLabel")}
              className="relative touch-none overflow-hidden rounded-md bg-surface-elevated outline-none ring-brand-primary focus-visible:ring-2"
              style={{ width: frame.width, height: frame.height, cursor: drag.current ? "grabbing" : "grab" }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: offset };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== e.pointerId || !image) return;
                setOffset(clampOffset({ x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y }, image, frame, zoom));
              }}
              onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 20 : 6;
                if (e.key === "ArrowLeft") { e.preventDefault(); move(step, 0); }
                if (e.key === "ArrowRight") { e.preventDefault(); move(-step, 0); }
                if (e.key === "ArrowUp") { e.preventDefault(); move(0, step); }
                if (e.key === "ArrowDown") { e.preventDefault(); move(0, -step); }
                if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoomTo(zoom + 0.1); }
                if (e.key === "-") { e.preventDefault(); setZoomTo(zoom - 0.1); }
              }}
            >
              {url && image && (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                <img src={url} alt="" draggable={false} className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
                  style={{ width: image.width * s, height: image.height * s, transform: `translate(${offset.x}px, ${offset.y}px)` }} />
              )}
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-text/30" />
            </div>
          </div>

          <label className="block text-sm text-text-muted">
            {t("memberCard.crop.zoom")}
            <input type="range" min={CROP_MIN_ZOOM} max={CROP_MAX_ZOOM} step={0.01} value={zoom}
              onChange={(e) => setZoomTo(Number(e.target.value))} className="mt-1 w-full accent-brand-primary" disabled={!image} />
          </label>
          <p className="text-xs text-text-muted">{t("memberCard.crop.hint")}</p>
          {failed && <p role="alert" className="text-sm text-danger">{t("athletePhoto.errors.decode")}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
            <Button type="button" onClick={confirm} disabled={!image || busy} loading={busy}>{t("memberCard.crop.use")}</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}

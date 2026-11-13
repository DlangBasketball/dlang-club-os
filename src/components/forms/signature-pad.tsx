"use client";

import * as React from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

/**
 * Drawn signature (pointer events: mouse, touch, pen). Emits a PNG data URL
 * after each stroke, or null when cleared. Colours come from theme tokens:
 * the pad uses --text as paper and --bg as ink, so the stored PNG has dark
 * strokes for the PDF on the default theme.
 */
export function SignaturePad({ value, onChange, label }: { value: string | null; onChange: (dataUrl: string | null) => void; label: string }) {
  const t = useT();
  const ref = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const last = React.useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = React.useState(!value);
  const inked = React.useRef(false);

  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.max(1, Math.round(width * ratio));
    c.height = Math.max(1, Math.round(height * ratio));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(c).getPropertyValue("--bg").trim() || "currentColor";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    inked.current = true;
    setEmpty(false);
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (ref.current && inked.current) onChange(ref.current.toDataURL("image/png"));
  };
  const clear = () => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    inked.current = false;
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        aria-label={label}
        role="img"
        className="h-32 w-full touch-none rounded border border-border"
        style={{ background: "var(--text)" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      <div className="flex items-center justify-between text-xs text-ink-3">
        <span>{empty ? t("forms.fill.drawHint") : t("forms.fill.drawn")}</span>
        <Button type="button" size="sm" variant="ghost" onClick={clear}><Eraser className="h-3.5 w-3.5" /> {t("forms.fill.clear")}</Button>
      </div>
    </div>
  );
}

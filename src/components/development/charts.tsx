import * as React from "react";

/**
 * Inline SVG progress charts. Colours only through theme tokens
 * (stroke-/fill- utilities mapped to CSS variables), so tenant palettes and
 * light/dark themes apply. Labels arrive pre-formatted (Intl, org locale).
 */

export type ChartPoint = { label: string; value: number; display: string };

export function LineChart({
  points, min, max, title, height = 180,
}: {
  points: ChartPoint[];
  min?: number;
  max?: number;
  title: string;
  height?: number;
}) {
  const W = 600;
  const H = height;
  const pad = { l: 44, r: 16, t: 14, b: 30 };
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  let lo = min ?? Math.min(...values);
  let hi = max ?? Math.max(...values);
  if (hi === lo) { lo -= 1; hi += 1; }
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)},${(H - pad.b).toFixed(1)} L${x(0).toFixed(1)},${(H - pad.b).toFixed(1)} Z`;
  const step = Math.max(1, Math.ceil(points.length / 6));
  const fmt = (v: number) => (Math.abs(hi - lo) >= 10 ? Math.round(v).toString() : v.toFixed(1));

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="h-auto w-full overflow-visible">
        <title>{title}</title>
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} className="stroke-border-soft" strokeWidth={1} strokeDasharray="3 4" />
            <text x={pad.l - 8} y={y(tk) + 4} textAnchor="end" className="fill-text-subtle text-[11px]">{fmt(tk)}</text>
          </g>
        ))}
        <path d={area} className="fill-brand-primary-soft" opacity={0.6} />
        <path d={path} className="fill-none stroke-brand-primary" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={4} className="fill-brand-primary stroke-bg" strokeWidth={2}>
              <title>{`${p.label}: ${p.display}`}</title>
            </circle>
            {i % step === 0 || i === points.length - 1 ? (
              <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-text-muted text-[11px]">{p.label}</text>
            ) : null}
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** Horizontal 0..100 bar (score / attendance / readiness). */
export function ScoreBar({ value, label }: { value: number | null; label: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-elevated" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      <div className="h-full rounded-full bg-brand-primary transition-[width]" style={{ width: `${v}%` }} />
    </div>
  );
}

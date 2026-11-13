import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight, dependency-free SVG charts (server components). Colours come
 * from theme tokens only (Tailwind fill-/stroke- classes mapped to CSS
 * variables), so tenant palettes apply. Every chart is an <svg role="img">
 * with a title and description, and ships a visually hidden data table for
 * screen readers. Labels and formatted values are passed in by the caller
 * (already translated / formatted for the locale).
 */
export type Series = { key: string; label: string; className: string; swatchClassName: string };

const W = 640;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 8 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-4 text-xs text-ink-3" aria-hidden>
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-2.5 w-2.5 rounded-sm", s.swatchClassName)} />{s.label}</li>
      ))}
    </ul>
  );
}

function SrTable({ caption, labels, series, values, format }: {
  caption: string; labels: string[]; series: Series[]; values: Record<string, number[]>; format: (n: number) => string;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">{caption}</th>{series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
      <tbody>
        {labels.map((l, i) => (
          <tr key={l + i}><th scope="row">{l}</th>{series.map((s) => <td key={s.key}>{format(values[s.key]?.[i] ?? 0)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

/** Grouped vertical bars (e.g. revenue vs expenses per month). Negative values are clamped to 0. */
export function BarChart({ title, labels, series, values, format, axisMax }: {
  title: string; labels: string[]; series: Series[]; values: Record<string, number[]>; format: (n: number) => string; axisMax?: string;
}) {
  const id = React.useId();
  const max = niceMax(Math.max(0, ...series.flatMap((s) => values[s.key] ?? [])));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const groupW = innerW / Math.max(labels.length, 1);
  const barW = Math.max(2, Math.min(28, (groupW * 0.7) / Math.max(series.length, 1)));
  const every = Math.ceil(labels.length / 12);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} className="h-auto w-full">
        <title id={`${id}-t`}>{title}</title>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH * (1 - g)} y2={PAD.top + innerH * (1 - g)} className="stroke-border-soft" strokeWidth={1} />
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} className="stroke-border" strokeWidth={1} />
        {labels.map((l, i) => {
          const gx = PAD.left + groupW * i + (groupW - barW * series.length) / 2;
          return (
            <g key={l + i}>
              {series.map((s, j) => {
                const v = Math.max(0, values[s.key]?.[i] ?? 0);
                const h = (v / max) * innerH;
                return <rect key={s.key} x={gx + j * barW} y={PAD.top + innerH - h} width={barW - 1} height={h} rx={2} className={s.className}><title>{`${l} · ${s.label}: ${format(values[s.key]?.[i] ?? 0)}`}</title></rect>;
              })}
              {i % every === 0 && <text x={PAD.left + groupW * i + groupW / 2} y={H - 8} textAnchor="middle" className="fill-text-muted text-[11px]">{l}</text>}
            </g>
          );
        })}
        {axisMax && <text x={PAD.left + 2} y={PAD.top + 10} className="fill-text-subtle text-[10px]">{axisMax.replace("{max}", format(max))}</text>}
      </svg>
      <Legend series={series} />
      <SrTable caption={title} labels={labels} series={series} values={values} format={format} />
    </figure>
  );
}

/** Line chart (e.g. student count trend). */
export function LineChart({ title, labels, series, values, format }: {
  title: string; labels: string[]; series: Series[]; values: Record<string, number[]>; format: (n: number) => string;
}) {
  const id = React.useId();
  const max = niceMax(Math.max(0, ...series.flatMap((s) => values[s.key] ?? [])));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = labels.length > 1 ? innerW / (labels.length - 1) : 0;
  const x = (i: number) => PAD.left + (labels.length > 1 ? step * i : innerW / 2);
  const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / max) * innerH;
  const every = Math.ceil(labels.length / 12);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} className="h-auto w-full">
        <title id={`${id}-t`}>{title}</title>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH * (1 - g)} y2={PAD.top + innerH * (1 - g)} className="stroke-border-soft" strokeWidth={1} />
        ))}
        {series.map((s) => {
          const vs = values[s.key] ?? [];
          const d = vs.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
          return (
            <g key={s.key}>
              <path d={d} fill="none" strokeWidth={2} className={s.className} />
              {vs.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3} className={cn(s.className, "fill-surface")} strokeWidth={2}><title>{`${labels[i]} · ${s.label}: ${format(v)}`}</title></circle>)}
            </g>
          );
        })}
        {labels.map((l, i) => i % every === 0 && <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-text-muted text-[11px]">{l}</text>)}
      </svg>
      <Legend series={series} />
      <SrTable caption={title} labels={labels} series={series} values={values} format={format} />
    </figure>
  );
}

/** Horizontal bars for ranked categories (e.g. registrations by programme). */
export function HBarChart({ title, rows, format, barClassName = "bg-brand-primary" }: {
  title: string; rows: { label: string; value: number }[]; format: (n: number) => string; barClassName?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.label + i} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-ink-2" title={r.label}>{r.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-surface-elevated" aria-hidden>
              <span className={cn("block h-full rounded-full", barClassName)} style={{ width: `${(Math.max(0, r.value) / max) * 100}%` }} />
            </span>
            <span className="tnum text-ink">{format(r.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

import * as React from "react";

/**
 * ===========================================================================
 * CAMP HERO AREA (placeholder)
 * Renders the camp's cover image (programs.cover_path / camp_editions
 * .cover_path, public club-media bucket) as a background with its focal
 * point. To be replaced after merge by <CoverImage> from
 * src/components/media/cover-image.tsx (banner + "Edit cover"); keep the
 * same props (coverUrl, focal x / y, title, kicker, children).
 * No child photos or names here — camp covers only.
 * ===========================================================================
 */
export function CampHero({
  coverUrl, focalX = 50, focalY = 50, kicker, title, children,
}: {
  coverUrl: string | null | undefined;
  focalX?: number;
  focalY?: number;
  kicker?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  const x = Math.min(100, Math.max(0, focalX));
  const y = Math.min(100, Math.max(0, focalY));
  return (
    <section
      data-camp-hero=""
      className={`relative overflow-hidden rounded-lg border border-line ${coverUrl ? "min-h-[180px] bg-surface sm:min-h-[220px]" : "bg-surface-elevated/40"}`}
      style={coverUrl ? { backgroundImage: `url("${coverUrl.replace(/"/g, "%22")}")`, backgroundSize: "cover", backgroundPosition: `${x}% ${y}%` } : undefined}
    >
      {coverUrl && <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-transparent" />}
      <div className={`relative flex flex-col justify-end gap-1 p-5 ${coverUrl ? "min-h-[180px] sm:min-h-[220px]" : ""}`}>
        {kicker && <div className="text-xs uppercase tracking-[0.18em] text-maroon">{kicker}</div>}
        <h1 className="font-display text-3xl font-semibold text-ink">{title}</h1>
        {children}
      </div>
    </section>
  );
}

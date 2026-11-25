import * as React from "react";
import { brandInitials, cardLayout, fitName, type CardLayout, type CourtsideBrand, type NameSize } from "@/lib/member-cards/courtside";
import { cn } from "@/lib/utils";

/**
 * "Courtside" member card (2:1, as in the approved mockup). Deep burgundy, cream
 * lettering, red accents, basketball court lines and a faint logo watermark;
 * every size is in container units (cqw) so the card scales from a 320 px
 * phone to desktop. Two layouts: WITH photo (framed portrait) and WITHOUT
 * photo (bigger logo, more room for the name), chosen from the data.
 *
 * Colours come from the card tokens in globals.css (courtside-*, card-qr*).
 * The QR markup is generated server-side from the opaque card token.
 */
export type CourtsideLabels = {
  member: string;
  /** Large title, e.g. "Member card". */
  title: string;
  /** Line under the name, e.g. "Show at training for check-in." */
  checkIn: string;
  tapToEnlarge: string;
  enlargeQr: string;
  inactive: string;
  photoAlt: string;
  cardAria: string;
};

/** Name size (cqw) inside the cream name banner, per layout and fit step. */
const NAME_CQW: Record<CardLayout, Record<NameSize, number>> = {
  photo:   { xl: 3.6, lg: 2.9, md: 2.4, sm: 2.0, xs: 1.65 },
  noPhoto: { xl: 3.6, lg: 2.9, md: 2.4, sm: 2.0, xs: 1.65 },
};

/** Frame, corner wedges, red stripes and court lines (viewBox 1000 x 500, same ratio as the card). */
function CardArt() {
  const stripes = (x: number, y: number, h: number, w: number, gap: number) =>
    [0, 1, 2].map((i) => {
      const x0 = x + i * (w + gap);
      return <polygon key={i} points={`${x0 + h * 0.55},${y} ${x0 + h * 0.55 + w},${y} ${x0 + w},${y + h} ${x0},${y + h}`} />;
    });
  return (
    <svg aria-hidden viewBox="0 0 1000 500" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
      {/* court lines */}
      <g fill="none" stroke="currentColor" strokeWidth={3} className="text-courtside-line opacity-[0.22]">
        <path d="M 0 150 A 100 100 0 0 1 0 350" />
        <path d="M 0 205 A 45 45 0 0 1 0 295" />
        <path d="M 30 190 L 30 310" strokeDasharray="10 10" />
        <path d="M 1000 140 A 115 115 0 0 0 1000 360" />
        <path d="M 1000 195 A 55 55 0 0 0 1000 305" strokeDasharray="10 10" />
      </g>
      {/* cream frame */}
      <rect x={22} y={22} width={956} height={456} fill="none" stroke="currentColor" strokeWidth={3} className="text-courtside-cream opacity-80" />
      {/* cream corner wedges (top left, bottom right) */}
      <g className="fill-courtside-cream">
        <polygon points="12,12 78,12 12,78" />
        <polygon points="988,488 922,488 988,422" />
      </g>
      {/* red stripes (top right, bottom left) */}
      <g className="fill-courtside-red">
        {stripes(850, 14, 34, 26, 12)}
        {stripes(18, 452, 34, 26, 12)}
      </g>
    </svg>
  );
}

function SamplePortrait() {
  return (
    <svg aria-hidden viewBox="0 0 80 100" className="h-full w-full bg-courtside-deep text-courtside-cream-muted">
      <circle cx={40} cy={38} r={17} fill="currentColor" opacity={0.75} />
      <path d="M8 100 C 10 72, 70 72, 72 100 Z" fill="currentColor" opacity={0.75} />
    </svg>
  );
}

/** Brand logo, or a clean text lockup (monogram + name) when the brand has no logo. */
function BrandMark({ brand, size }: { brand: CourtsideBrand; size: "top" | "side" }) {
  if (brand.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
      <img src={brand.logoUrl} alt={brand.displayName} className={cn("block w-auto object-contain drop-shadow-md",
        size === "side" ? "h-[34cqw] max-w-[23cqw]" : "h-[18cqw] max-w-[26cqw]")} />
    );
  }
  const side = size === "side";
  return (
    <div className={cn("flex min-w-0 items-center", side ? "flex-col gap-[1.4cqw] text-center" : "gap-[1.6cqw]")}>
      <span aria-hidden className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-[0.35cqw] border-courtside-cream bg-courtside-deep font-display font-black text-courtside-cream",
        side ? "h-[15cqw] w-[15cqw] text-[length:5.2cqw]" : "h-[8cqw] w-[8cqw] text-[length:3cqw]",
      )}>
        {brandInitials(brand.displayName)}
      </span>
      <div className="min-w-0">
        <div className={cn("font-display font-black uppercase leading-tight text-courtside-cream", side ? "text-[length:2.6cqw]" : "truncate text-[length:2.3cqw]")}>
          {brand.displayName}
        </div>
        {brand.subtitle && (
          <div className={cn("font-sans leading-tight text-courtside-cream-muted", side ? "text-[length:1.6cqw]" : "truncate text-[length:1.5cqw]")}>
            {brand.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/** "MEMBER CARD", the name on a cream banner between red slashes, and the check-in line. */
function Identity({ name, layout, labels, showCheckIn = true }: { name: string; layout: CardLayout; labels: CourtsideLabels; showCheckIn?: boolean }) {
  const fitted = fitName(name, layout);
  const slash = "h-[5cqw] w-[0.9cqw] shrink-0 -skew-x-[22deg] bg-courtside-red";
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <p className="whitespace-nowrap font-display font-black uppercase leading-none tracking-[0.01em] text-courtside-cream [font-size:4.7cqw] [text-shadow:0_0.3cqw_0.6cqw_rgb(0_0_0/0.35)]">
        {labels.title}
      </p>
      <div className="mt-[1.4cqw] flex w-full items-center justify-center gap-[0.6cqw]">
        <span aria-hidden className={slash} />
        <span aria-hidden className={slash} />
        <div className="min-w-0 flex-1 overflow-hidden -skew-x-[14deg] bg-courtside-cream px-[1.6cqw] py-[0.8cqw] shadow-md">
          <p className="skew-x-[14deg] font-display font-black uppercase leading-[1.05] text-courtside-bg"
            style={{ fontSize: `${NAME_CQW[layout][fitted.size]}cqw` }}>
            {fitted.lines.map((l, i) => <span key={i} className="block whitespace-nowrap">{l}</span>)}
          </p>
        </div>
        <span aria-hidden className={slash} />
        <span aria-hidden className={slash} />
      </div>
      {showCheckIn && (
        <div className="mt-[1.6cqw] flex w-full items-center justify-center gap-[1.4cqw]">
          <span aria-hidden className="h-[0.25cqw] w-[2.6cqw] shrink-0 bg-courtside-cream" />
          <p className="whitespace-nowrap font-display italic leading-tight text-courtside-cream [font-size:1.85cqw]">{labels.checkIn}</p>
          <span aria-hidden className="h-[0.25cqw] w-[2.6cqw] shrink-0 bg-courtside-cream" />
        </div>
      )}
    </div>
  );
}

export function CourtsideCard({
  brand, name, photoUrl, samplePhoto = false, qrSvg, cardActive = true, showQr = true, labels, onEnlarge, className,
}: {
  brand: CourtsideBrand;
  name: string;
  photoUrl: string | null;
  /** Card preview only: synthetic silhouette instead of a real photo. */
  samplePhoto?: boolean;
  qrSvg: string | null;
  cardActive?: boolean;
  /** Club decision: without QR check-in the card has no QR column (name and logo get the room). */
  showQr?: boolean;
  labels: CourtsideLabels;
  onEnlarge?: () => void;
  className?: string;
}) {
  const layout: CardLayout = samplePhoto ? "photo" : cardLayout(photoUrl);
  const watermark = brand.watermarkUrl ?? brand.logoUrl;
  const live = !!(qrSvg && cardActive);

  const qr = live ? (
    <span className="block aspect-square w-full [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg! }} />
  ) : (
    <span className="flex aspect-square w-full items-center justify-center text-center font-sans text-[length:2cqw] font-medium text-card-qr-ink">
      {labels.inactive}
    </span>
  );
  const qrFrame = "block w-full border-[0.45cqw] border-courtside-cream-muted bg-card-qr p-[1cqw] shadow-lg";

  return (
    <div role="group" aria-label={labels.cardAria}
      className={cn("relative aspect-[2/1] w-full select-none overflow-hidden rounded-[1.2cqw] bg-courtside text-courtside-cream shadow-lg ring-1 ring-courtside-cream/10", className)}
      style={{ containerType: "inline-size" }}>
      <CardArt />
      {watermark && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, decorative
        <img src={watermark} alt="" aria-hidden
          className={cn("pointer-events-none absolute object-contain opacity-[0.13] [filter:grayscale(0.6)]",
            layout === "photo" ? "left-[56%] top-[4%] h-[46%] w-[26%]" : "left-[40%] top-[3%] h-[60%] w-[34%]")} />
      )}

      <div className={cn("relative grid h-full items-center gap-[2.2cqw] px-[6cqw] py-[4.5cqw]", showQr ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)]")}>
        {layout === "photo" ? (
          <div className="relative w-[21cqw] self-center">
            {/* cream offset corner behind the frame */}
            <span aria-hidden className="absolute -bottom-[1cqw] -right-[1cqw] h-[60%] w-[60%] border-b-[0.6cqw] border-r-[0.6cqw] border-courtside-cream" />
            <div className="relative aspect-[4/5] w-full overflow-hidden border-[0.6cqw] border-courtside-red bg-courtside-deep shadow-lg">
              {samplePhoto || !photoUrl ? <SamplePortrait /> : (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL (private bucket)
                <img src={photoUrl} alt={labels.photoAlt} className="h-full w-full object-cover" />
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center gap-[2.4cqw]">
            <div className="flex w-[23cqw] justify-center"><BrandMark brand={brand} size="side" /></div>
            <span aria-hidden className="h-[70%] w-[0.25cqw] bg-courtside-cream/80" />
          </div>
        )}

        <div className="flex min-w-0 flex-col items-center justify-center gap-[1.2cqw]">
          {layout === "photo" && <BrandMark brand={brand} size="top" />}
          <Identity name={name} layout={layout} labels={labels} showCheckIn={showQr} />
        </div>

        {showQr && <div className={cn("shrink-0 self-center", layout === "photo" ? "w-[18cqw] mt-[8cqw]" : "w-[18cqw]")}>
          {onEnlarge && live ? (
            <button type="button" onClick={onEnlarge} aria-label={labels.enlargeQr}
              className={cn(qrFrame, "outline-none ring-courtside-red focus-visible:ring-[0.6cqw]")}>
              {qr}
            </button>
          ) : (
            <div className={qrFrame}>{qr}</div>
          )}
          {onEnlarge && live && (
            <p className="mt-[0.6cqw] text-center font-sans text-[length:1.6cqw] text-courtside-cream-muted">{labels.tapToEnlarge}</p>
          )}
        </div>}
      </div>
    </div>
  );
}

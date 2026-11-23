import * as React from "react";
import { brandInitials, cardLayout, fitName, type CardLayout, type CourtsideBrand, type NameSize } from "@/lib/member-cards/courtside";
import { cn } from "@/lib/utils";

/**
 * "Courtside" member card (credit-card ratio 85.6 x 54). Deep burgundy, cream
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
  tapToEnlarge: string;
  enlargeQr: string;
  inactive: string;
  photoAlt: string;
  cardAria: string;
};

const NAME_CQW: Record<CardLayout, Record<NameSize, number>> = {
  photo:   { xl: 6.4, lg: 5.4, md: 4.6, sm: 3.9, xs: 3.3 },
  noPhoto: { xl: 7.2, lg: 6.0, md: 5.0, sm: 4.2, xs: 3.5 },
};

function CourtLines() {
  return (
    <svg aria-hidden viewBox="0 0 856 540" preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full text-courtside-line opacity-[0.16]"
      fill="none" stroke="currentColor" strokeWidth={3}>
      <rect x={18} y={18} width={820} height={504} rx={10} />
      {/* centre circle on the half-way line (left edge) */}
      <circle cx={18} cy={270} r={92} />
      <circle cx={18} cy={270} r={30} />
      {/* three-point arc */}
      <path d="M 838 46 L 720 46 A 232 232 0 0 0 720 494 L 838 494" />
      {/* key / lane + free-throw circle */}
      <rect x={648} y={190} width={190} height={160} />
      <circle cx={648} cy={270} r={80} strokeDasharray="10 12" />
      {/* backboard + rim */}
      <line x1={812} y1={236} x2={812} y2={304} />
      <circle cx={796} cy={270} r={13} />
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

function Lockup({ brand, layout }: { brand: CourtsideBrand; layout: CardLayout }) {
  const big = layout === "noPhoto";
  return (
    <div className="flex min-w-0 items-center gap-[2.2cqw]">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        <img src={brand.logoUrl} alt="" className={cn("w-auto shrink-0 object-contain", big ? "h-[12cqw] max-w-[30cqw]" : "h-[8.5cqw] max-w-[22cqw]")} />
      ) : (
        <span aria-hidden className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-courtside-cream-muted font-display font-semibold tracking-tight text-courtside-cream",
          big ? "h-[11cqw] w-[11cqw] text-[length:4.2cqw]" : "h-[8.5cqw] w-[8.5cqw] text-[length:3.3cqw]",
        )}>
          {brandInitials(brand.displayName)}
        </span>
      )}
      <div className="min-w-0">
        <div className={cn("truncate font-sans font-semibold uppercase leading-tight tracking-[0.14em] text-courtside-cream",
          big ? "text-[length:3.4cqw]" : "text-[length:2.9cqw]")}>
          {brand.displayName}
        </div>
        {brand.subtitle && (
          <div className={cn("truncate font-sans leading-tight text-courtside-cream-muted", big ? "text-[length:2.4cqw]" : "text-[length:2.1cqw]")}>
            {brand.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

export function CourtsideCard({
  brand, name, photoUrl, samplePhoto = false, qrSvg, cardActive = true, labels, onEnlarge, className,
}: {
  brand: CourtsideBrand;
  name: string;
  photoUrl: string | null;
  /** Card preview only: synthetic silhouette instead of a real photo. */
  samplePhoto?: boolean;
  qrSvg: string | null;
  cardActive?: boolean;
  labels: CourtsideLabels;
  onEnlarge?: () => void;
  className?: string;
}) {
  const layout: CardLayout = samplePhoto ? "photo" : cardLayout(photoUrl);
  const fitted = fitName(name, layout);
  const watermark = brand.watermarkUrl ?? brand.logoUrl;
  const qrBox = layout === "photo" ? "w-[23cqw]" : "w-[25cqw]";

  const qr = qrSvg && cardActive ? (
    <span className="block aspect-square w-full [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
  ) : (
    <span className="flex aspect-square w-full items-center justify-center text-center font-sans text-[length:2.3cqw] font-medium text-card-qr-ink">
      {labels.inactive}
    </span>
  );

  return (
    <div role="group" aria-label={labels.cardAria}
      className={cn("relative aspect-[85.6/54] w-full select-none overflow-hidden rounded-[4.5cqw] bg-courtside text-courtside-cream shadow-lg ring-1 ring-courtside-cream/10", className)}
      style={{ containerType: "inline-size" }}>
      <CourtLines />
      {watermark && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, decorative
        <img src={watermark} alt="" aria-hidden
          className="pointer-events-none absolute left-[38%] top-1/2 h-[72%] w-[48%] -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.07] [filter:grayscale(1)]" />
      )}
      {/* red accent along the top edge */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-[1.1cqw] bg-courtside-red" />

      <div className="relative flex h-full flex-col justify-between p-[5cqw] pt-[5.6cqw]">
        <div className="flex items-start justify-between gap-[3cqw]">
          <Lockup brand={brand} layout={layout} />
          <span className="shrink-0 rounded-full border border-courtside-red px-[2cqw] py-[0.5cqw] font-sans text-[length:2.1cqw] font-semibold uppercase tracking-[0.18em] text-courtside-cream">
            {labels.member}
          </span>
        </div>

        <div className="flex items-end gap-[3.2cqw]">
          {layout === "photo" && (
            <div className="w-[21cqw] shrink-0 rounded-[1.6cqw] border border-courtside-cream-muted/70 bg-courtside-deep p-[0.7cqw]">
              <div className="aspect-[4/5] w-full overflow-hidden rounded-[1.1cqw]">
                {samplePhoto || !photoUrl ? <SamplePortrait /> : (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL (private bucket)
                  <img src={photoUrl} alt={labels.photoAlt} className="h-full w-full object-contain" />
                )}
              </div>
            </div>
          )}
          <div className="min-w-0 flex-1 pb-[0.6cqw]">
            <span aria-hidden className="mb-[1.4cqw] block h-[0.6cqw] w-[9cqw] rounded-full bg-courtside-red" />
            <p className="font-display font-semibold leading-[1.05] tracking-[-0.01em] text-courtside-cream [overflow-wrap:anywhere]"
              style={{ fontSize: `${NAME_CQW[layout][fitted.size]}cqw` }}>
              {fitted.lines.map((l, i) => <span key={i} className="block">{l}</span>)}
            </p>
          </div>
          <div className={cn("shrink-0", qrBox)}>
            {onEnlarge && qrSvg && cardActive ? (
              <button type="button" onClick={onEnlarge} aria-label={labels.enlargeQr}
                className="block w-full rounded-[2cqw] bg-card-qr p-[1.3cqw] shadow-md outline-none ring-courtside-red focus-visible:ring-[0.6cqw]">
                {qr}
              </button>
            ) : (
              <div className="w-full rounded-[2cqw] bg-card-qr p-[1.3cqw] shadow-md">{qr}</div>
            )}
            {onEnlarge && qrSvg && cardActive && (
              <p className="mt-[0.8cqw] text-center font-sans text-[length:1.9cqw] text-courtside-cream-muted">{labels.tapToEnlarge}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

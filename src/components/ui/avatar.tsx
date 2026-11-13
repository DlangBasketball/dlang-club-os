"use client";

import * as React from "react";
import { cn, initials } from "@/lib/utils";

const SIZES = {
  sm: "h-7 w-7 text-[10.5px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-[13px]",
  xl: "h-16 w-16 text-xl",
  "2xl": "h-28 w-28 text-3xl",
} as const;

/**
 * Initials avatar — prototype `.avatar` (brand tint) / `.avatar.gold`.
 * With `src` (a short-lived signed URL of a private photo) it shows the photo
 * and falls back to the initials if the image fails to load (e.g. expired).
 * Decorative next to a visible name; pass `alt` when the photo stands alone.
 */
export function Avatar({
  name,
  src,
  alt,
  size = "md",
  tone = "brand",
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  alt?: string;
  size?: keyof typeof SIZES;
  tone?: "brand" | "accent" | "neutral";
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  const showPhoto = !!src && !failed;
  return (
    <span
      aria-hidden={alt ? undefined : true}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
        SIZES[size],
        !showPhoto && tone === "brand" && "bg-gradient-to-br from-brand-primary to-brand-primary-dark text-on-brand",
        !showPhoto && tone === "accent" && "bg-brand-accent text-on-accent",
        !showPhoto && tone === "neutral" && "border border-border bg-bg-secondary text-text-secondary",
        showPhoto && "border border-border bg-bg-secondary",
        className,
      )}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private URL; not for the image optimiser
        <img
          src={src as string}
          alt={alt ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

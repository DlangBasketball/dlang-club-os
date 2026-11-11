"use client";

import { cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant/context";
import { APP_TAGLINE } from "@/lib/constants";

/** Monogram from a tenant name: "DLang Basketball" -> "D", "Riverside High" -> "R". */
export function monogram(name: string): string {
  const ch = name.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return (ch ?? "C").toUpperCase();
}

/**
 * Tenant brand lockup: logo (or monogram tile in the brand color) + name.
 * Pass `name`/`logoUrl` to override (e.g. the branding live preview).
 */
export function BrandMark({
  compact = false,
  className,
  name,
  logoUrl,
  tagline = "Club OS",
}: {
  compact?: boolean;
  className?: string;
  name?: string;
  logoUrl?: string | null;
  tagline?: string;
}) {
  const tenant = useTenant();
  const displayName = name ?? tenant.name;
  const logo = logoUrl === undefined ? tenant.branding.logoUrl : logoUrl;
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- tenant logos are arbitrary remote URLs
        <img src={logo} alt={`${displayName} logo`} className="h-9 w-9 rounded-md object-contain" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-maroon shadow-glow-red" aria-hidden>
          <span className="font-display text-lg font-bold text-inverse">{monogram(displayName)}</span>
        </div>
      )}
      {!compact && (
        <div className="leading-tight">
          <div className="font-display text-sm font-semibold text-ink">{displayName}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3" title={APP_TAGLINE}>
            {tagline}
          </div>
        </div>
      )}
    </div>
  );
}

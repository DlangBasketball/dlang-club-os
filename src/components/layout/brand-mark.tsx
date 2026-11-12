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
 * Wordmark — prototype `.dl-wordmark`: logo (or gradient brand tile with a
 * monogram) + display-serif name + uppercase tag. Defaults come from the
 * current tenant; pass `name` / `logoUrl` / `initial` to override (e.g. the
 * branding live preview).
 */
export function BrandMark({
  compact = false,
  className,
  name,
  logoUrl,
  tagline = "Club OS",
  initial,
}: {
  compact?: boolean;
  className?: string;
  name?: string;
  logoUrl?: string | null;
  tagline?: string;
  initial?: string;
}) {
  const tenant = useTenant();
  const displayName = name ?? tenant.name;
  const logo = logoUrl === undefined ? tenant.branding.logoUrl : logoUrl;
  const letter = (initial ?? monogram(displayName)).toUpperCase();
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- tenant logos are arbitrary remote URLs
        <img src={logo} alt={`${displayName} logo`} className="h-9 w-9 shrink-0 rounded-md object-contain" />
      ) : (
        <div
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-primary to-brand-primary-dark shadow-glow"
        >
          <span className="font-display text-lg font-semibold text-on-brand">{letter}</span>
        </div>
      )}
      {compact ? (
        <span className="sr-only">{displayName}</span>
      ) : (
        <div className="min-w-0 leading-tight">
          <div className="truncate font-display text-[15px] font-medium tracking-[-0.02em] text-text">
            {displayName}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted" title={APP_TAGLINE}>
            {tagline}
          </div>
        </div>
      )}
    </div>
  );
}

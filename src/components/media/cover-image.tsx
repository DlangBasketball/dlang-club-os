"use client";

import * as React from "react";
import { ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { objectPosition, type CoverTarget, type CoverView } from "@/lib/media/cover";
import { CoverEditorDialog } from "./cover-editor";

export type CoverEditConfig = {
  /** Which record the cover belongs to. */
  target: CoverTarget;
  /** Its id (for 'org' the signed-in user's org id). */
  id: string;
  /** Offer "Choose from library" (admins; the library is staff-only). */
  canUseLibrary?: boolean;
  /**
   * Public surface (club hub, programme / camp pages): the dialog then asks
   * for the consent confirmation before a new image is used. Defaults to the
   * target (org, program, camp_edition are public).
   */
  publicSurface?: boolean;
};

export type CoverVariant = "hero" | "banner" | "subtle" | "compact";

export type CoverImageProps = {
  /** From resolveCover() / getOrgCover() / getTeamCover() / getAthleteCover(). Null = brand fallback. */
  cover?: CoverView | null;
  /** Alt text of the image; omit for a decorative cover (the title says it all). */
  alt?: string;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Extra content inside the banner (chips, actions), below the subtitle. */
  children?: React.ReactNode;
  /**
   * hero: club hub / camp landing (tall) · banner: team / profile header ·
   * subtle: dashboards (fades into the page, normal text colours) ·
   * compact: cards and lists.
   */
  variant?: CoverVariant;
  /** Show the "Edit cover" button (only pass it for users who may edit). */
  edit?: CoverEditConfig | null;
  className?: string;
  contentClassName?: string;
  /** Load eagerly (above the fold). */
  priority?: boolean;
};

const HEIGHT: Record<CoverVariant, string> = {
  hero: "min-h-[14rem] sm:min-h-[18rem] lg:min-h-[20rem]",
  banner: "min-h-[9rem] sm:min-h-[12rem]",
  subtle: "min-h-[7rem] sm:min-h-[9rem]",
  compact: "min-h-[6rem]",
};

/**
 * Full-width cover banner with a readable gradient scrim, focal-point
 * positioning and, for authorised users, an "Edit cover" button. Without an
 * image it shows the tenant's brand gradient pattern. Colours come only from
 * theme tokens (--cover-*), so tenants re-brand it with the rest of the app.
 */
export function CoverImage({
  cover,
  alt,
  eyebrow,
  title,
  subtitle,
  children,
  variant = "banner",
  edit,
  className,
  contentClassName,
  priority = false,
}: CoverImageProps) {
  const t = useT();
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const url = cover?.url ?? null;
  React.useEffect(() => setFailed(false), [url]);
  const showImage = !!url && !failed;
  const subtle = variant === "subtle";

  return (
    <section
      className={cn(
        "relative isolate flex w-full flex-col justify-end overflow-hidden rounded-lg border border-border bg-cover-fallback",
        HEIGHT[variant],
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- public library URL or short-lived signed URL; not for the image optimiser
        <img
          src={url!}
          alt={alt ?? ""}
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          style={{ objectPosition: objectPosition(cover?.focalX, cover?.focalY) }}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 -z-20 bg-cover-pattern" />
      )}
      <div aria-hidden className={cn("absolute inset-0 -z-10", subtle ? "bg-cover-scrim-subtle" : "bg-cover-scrim")} />

      {edit && (
        <div className="absolute right-3 top-3 z-10">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-cover-chip-border bg-cover-chip px-3 text-xs font-medium text-cover-text backdrop-blur transition hover:border-cover-text focus-visible:shadow-focus sm:min-h-0 sm:py-1.5"
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            {t("media.cover.edit")}
          </button>
        </div>
      )}

      {(eyebrow || title || subtitle || children) && (
        <div className={cn("relative px-4 pb-4 pt-12 sm:px-6 sm:pb-6", contentClassName)}>
          {eyebrow && (
            <p className={cn("text-[11px] font-medium uppercase tracking-[0.18em]", subtle ? "text-brand-accent" : "text-cover-text-muted")}>
              {eyebrow}
            </p>
          )}
          {title && (
            <h1
              className={cn(
                "mt-1 font-display font-semibold leading-tight",
                variant === "hero" ? "text-3xl sm:text-4xl lg:text-5xl" : "text-2xl sm:text-3xl",
                subtle ? "text-text" : "text-cover-text [text-shadow:var(--cover-text-shadow)]",
              )}
            >
              {title}
            </h1>
          )}
          {subtitle && (
            <div className={cn("mt-2 max-w-2xl text-sm leading-relaxed", subtle ? "text-text-muted" : "text-cover-text-muted")}>{subtitle}</div>
          )}
          {children && <div className="mt-3">{children}</div>}
        </div>
      )}

      {edit && open && (
        <CoverEditorDialog
          open={open}
          onClose={() => setOpen(false)}
          target={edit.target}
          id={edit.id}
          canUseLibrary={!!edit.canUseLibrary}
          publicSurface={edit.publicSurface}
          current={cover ?? null}
        />
      )}
    </section>
  );
}

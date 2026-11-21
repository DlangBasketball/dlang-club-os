import Image from "next/image";
import { cn } from "@/lib/utils";
import { objectPosition } from "@/lib/media/cover";
import type { MediaRef } from "@/lib/site/blocks";
import type { RenderCtx, SiteImg } from "./types";

/** Look up a block's library image; uncleared images exist only in the admin preview. */
export function resolveImg(ctx: RenderCtx, ref: MediaRef | null | undefined): (SiteImg & { ref: MediaRef }) | null {
  if (!ref) return null;
  const img = ctx.images.get(ref.path);
  if (!img) return null;
  if (!img.cleared && !ctx.preview) return null;
  return { ...img, ref };
}

/**
 * Responsive, lazy image (next/image; club media is served from Supabase
 * Storage, allowed in next.config remotePatterns). `fill` covers its parent;
 * otherwise width/height keep the aspect ratio.
 */
export function SiteImage({
  img,
  sizes,
  fill = false,
  priority = false,
  className,
  alt,
  unclearedLabel,
}: {
  img: (SiteImg & { ref?: MediaRef }) | null;
  sizes: string;
  fill?: boolean;
  priority?: boolean;
  className?: string;
  alt?: string;
  unclearedLabel?: string;
}) {
  if (!img) return null;
  const text = alt ?? img.ref?.alt ?? img.alt ?? "";
  const pos = objectPosition(img.ref?.focalX, img.ref?.focalY);
  return (
    <>
      {fill ? (
        <Image src={img.url} alt={text} fill sizes={sizes} priority={priority} className={cn("object-cover", className)} style={{ objectPosition: pos }} />
      ) : (
        <Image
          src={img.url}
          alt={text}
          width={img.width ?? 1600}
          height={img.height ?? 1067}
          sizes={sizes}
          priority={priority}
          className={cn("h-auto w-full object-cover", className)}
          style={{ objectPosition: pos }}
        />
      )}
      {!img.cleared && unclearedLabel && (
        <span className="absolute start-2 top-2 z-10 rounded bg-warning px-2 py-1 text-xs font-semibold text-bg">{unclearedLabel}</span>
      )}
    </>
  );
}

/** Remote image of live data (camp covers, shop, coach photos): already public. */
export function RemoteImage({ src, alt, sizes, className }: { src: string; alt: string; sizes: string; className?: string }) {
  return <Image src={src} alt={alt} fill sizes={sizes} className={cn("object-cover", className)} />;
}

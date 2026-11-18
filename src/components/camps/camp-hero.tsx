import * as React from "react";
import { CoverImage } from "@/components/media/cover-image";

/**
 * Camp hero: the camp's cover image (programs.cover_path, public club-media
 * bucket) with its focal point, rendered by the shared <CoverImage> banner.
 * Pass `editProgramId` (admins only) to show the "Edit cover" button.
 * No child photos or names here without media consent: camp covers are public.
 */
export function CampHero({
  coverUrl, coverPath = null, focalX = 50, focalY = 50, kicker, title, children, editProgramId = null,
}: {
  coverUrl: string | null | undefined;
  coverPath?: string | null;
  focalX?: number;
  focalY?: number;
  kicker?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  editProgramId?: string | null;
}) {
  return (
    <CoverImage
      cover={coverUrl ? { url: coverUrl, focalX, focalY, path: coverPath } : null}
      eyebrow={kicker}
      title={title}
      variant="hero"
      edit={editProgramId ? { target: "program", id: editProgramId, canUseLibrary: true, publicSurface: true } : null}
    >
      {children}
    </CoverImage>
  );
}

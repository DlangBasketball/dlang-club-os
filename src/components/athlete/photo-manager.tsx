"use client";

import { PersonPhotoManager } from "@/components/people/person-photo-manager";

/**
 * Upload / replace / remove an athlete's identification photo. Used by admins
 * (player profile, member card) and guardians (parent app, own child). Thin
 * wrapper over the shared PersonPhotoManager.
 */
export function PhotoManager({
  athleteId,
  name,
  photoUrl,
  compact = false,
  variant = "default",
}: {
  athleteId: string;
  name: string;
  photoUrl: string | null;
  compact?: boolean;
  variant?: "default" | "card";
}) {
  return <PersonPhotoManager subject="athlete" id={athleteId} name={name} photoUrl={photoUrl} compact={compact} variant={variant} />;
}

"use client";
import { MapPin, ExternalLink } from "lucide-react";
import { eventPlace, eventPlaceLine, mapsUrl, type EventPlaceInput } from "@/lib/sportsops/location";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Where an event happens: club venue (+ court/field) or away/other location,
 * with an optional maps link (not inside another link: withMap=false there).
 */
export function EventPlaceView({ e, withMap, className, iconClassName = "h-3 w-3" }: {
  e: EventPlaceInput; withMap?: boolean; className?: string; iconClassName?: string;
}) {
  const t = useT();
  const p = eventPlace(e);
  const line = eventPlaceLine(p);
  const url = withMap ? mapsUrl(p.address ?? (p.isVenue ? null : p.label)) : null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <MapPin className={cn("shrink-0", iconClassName)} />
      {!p.isVenue && line && <span className="text-ink-3">{t("editOps.events.awayPrefix")}</span>}
      <span>{line ?? t("editOps.events.locationTbc")}</span>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-maroon hover:underline">
          <ExternalLink className="h-3 w-3" />{t("editOps.events.openMap")}
        </a>
      )}
    </span>
  );
}

/** Cancellation note ("Cancelled: gym closed"). */
export function EventCancelNote({ reason, className }: { reason: string | null | undefined; className?: string }) {
  const t = useT();
  if (!reason) return null;
  return <p className={cn("text-sm text-danger", className)}>{t("editOps.events.cancelledBecause", { reason })}</p>;
}

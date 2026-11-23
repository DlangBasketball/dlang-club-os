import Link from "next/link";
import { ChevronLeft, Clock, MapPin } from "lucide-react";
import { Badge } from "@/components/ui";
import type { Formatter } from "@/lib/format";
import type { Translator } from "@/lib/i18n/translator";
import { SheetStatusBadge, eventTypeLabel } from "./training-card";

/** Session header shared by the sheet and details pages (server component). */
export function SessionHeader({
  t, f, teamName, title, type, startsAt, endsAt, location, cancelled, sheetStatus, substitute, booked, links,
}: {
  t: Translator; f: Formatter;
  teamName: string | null; title: string | null; type: string; startsAt: string; endsAt: string; location?: string | null;
  cancelled: boolean; sheetStatus?: "draft" | "final" | "reopened" | null; substitute?: boolean;
  /** A booked private / group session (no team): the title is the service name. */
  booked?: boolean;
  links?: React.ReactNode;
}) {
  return (
    <header className="mb-4 border-b border-border pb-4">
      <Link href="/coach/trainings" className="touch-target -ml-1 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {t("coachTrainings.backToList")}
      </Link>
      <div className="mt-1 flex flex-wrap items-start gap-2">
        <h1 className="mr-auto font-display text-2xl leading-tight text-text">{teamName ?? title ?? eventTypeLabel(type, t)}</h1>
        <div className="flex flex-wrap gap-1.5">
          {cancelled ? <Badge tone="danger">{t("coachTrainings.card.cancelled")}</Badge>
            : sheetStatus !== undefined && <SheetStatusBadge status={sheetStatus} t={t} />}
          {substitute && <Badge tone="info">{t("coachTrainings.card.substitute")}</Badge>}
          {booked && <Badge tone="accent">{t("bookingPortal.bookedSession")}</Badge>}
        </div>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-text-muted" aria-hidden />
          {eventTypeLabel(type, t)} · {f.date(startsAt, { weekday: true })} · {f.time(startsAt)}–{f.time(endsAt)}
        </span>
        {location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-text-muted" aria-hidden />{location}</span>}
      </p>
      {links && <div className="mt-3 flex flex-wrap gap-2">{links}</div>}
    </header>
  );
}

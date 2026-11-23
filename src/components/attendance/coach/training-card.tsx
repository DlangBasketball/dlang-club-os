import Link from "next/link";
import { CalendarX2, ChevronRight, Clock, MapPin, Users } from "lucide-react";
import { Badge, buttonVariants } from "@/components/ui";
import type { TrainingCard } from "@/lib/attendance/coach-data";
import type { BookedSessionInfo } from "@/lib/booking/portal";
import { BookedSessionDetails } from "@/components/booking/portal/coach-session";
import type { Formatter } from "@/lib/format";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";

/** Sheet status pill: not started / draft / final / reopened. */
export function SheetStatusBadge({ status, t }: { status: "draft" | "final" | "reopened" | null; t: Translator }) {
  if (!status) return <Badge tone="neutral">{t("coachTrainings.card.notStarted")}</Badge>;
  return <Badge tone={status === "final" ? "success" : "warning"} dot>{t(`teamAttendance.sheetStatuses.${status}`)}</Badge>;
}

export function eventTypeLabel(type: string, t: Translator): string {
  return t.dynamic(`coachTrainings.types.${type}`, undefined, type);
}

/**
 * One session on the coach's trainings list (server component). Big tap
 * target to take attendance; cancelled sessions show no action.
 */
export function TrainingCardView({ card, t, f, showDate, session }: {
  card: TrainingCard; t: Translator; f: Formatter; showDate?: boolean;
  /** The booked session behind this event (service name, roster names; no team, no money). */
  session?: BookedSessionInfo | null;
}) {
  const cancelled = card.event_status === "cancelled";
  const title = session?.serviceName ?? card.team_name ?? card.title ?? eventTypeLabel(card.event_type, t);
  const detailsHref = `/coach/trainings/${card.event_id}`;
  const action = !cancelled && card.can_run
    ? card.sheet_status === "final"
      ? { href: `${detailsHref}/attendance`, label: t("coachTrainings.card.view"), primary: false }
      : { href: `${detailsHref}/attendance`, label: card.sheet_status ? t("coachTrainings.card.continue") : t("coachTrainings.card.take"), primary: true }
    : null;

  return (
    <article className={cn("rounded-lg border bg-surface p-4", cancelled ? "border-border opacity-80" : "border-border-strong")}
             aria-labelledby={`card-${card.event_id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`card-${card.event_id}`} className="font-display text-lg leading-tight text-text">
            <Link href={detailsHref} className="hover:underline focus-visible:outline-none focus-visible:shadow-focus">{title}</Link>
          </h3>
          <p className="mt-0.5 text-xs text-text-muted">
            {session ? t("bookingPortal.bookedSession") : (
              <>
                {eventTypeLabel(card.event_type, t)}
                {card.title && card.team_name && <> · {card.title}</>}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {cancelled
            ? <Badge tone="danger">{t("coachTrainings.card.cancelled")}</Badge>
            : <SheetStatusBadge status={card.sheet_status} t={t} />}
          {card.access === "substitute" && <Badge tone="info">{t("coachTrainings.card.substitute")}</Badge>}
          {card.access === "lead" && <Badge tone="info">{t("coachTrainings.card.lead")}</Badge>}
          {card.access === "pending" && <Badge tone="warning">{t("coachTrainings.card.pending")}</Badge>}
        </div>
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-1.5 text-sm text-text-secondary sm:grid-cols-2">
        <li className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          <span>
            {showDate && <>{f.date(card.starts_at, { weekday: true })} · </>}
            {f.time(card.starts_at)}–{f.time(card.ends_at)}
          </span>
        </li>
        {card.location_name && (
          <li className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-text-muted" aria-hidden /><span className="truncate">{card.location_name}</span></li>
        )}
        {card.roster_size !== null && (
          <li className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />{t("coachTrainings.card.rosterSize", { count: card.roster_size })}</li>
        )}
        {card.can_run && (
          <li className={cn("flex items-center gap-2", card.reported_absences > 0 && "text-info")}>
            <CalendarX2 className="h-4 w-4 shrink-0" aria-hidden />{t("coachTrainings.card.absences", { count: card.reported_absences })}
          </li>
        )}
      </ul>

      {session && <BookedSessionDetails session={session} t={t} f={f} />}

      {cancelled && card.cancel_reason && (
        <p className="mt-2 text-sm text-text-muted">{t("coachTrainings.card.cancelledReason", { reason: card.cancel_reason })}</p>
      )}
      {!cancelled && card.sheet_status && card.sheet_status !== "final" && card.unmarked > 0 && (
        <p className="mt-2 text-sm text-warning">{t("coachTrainings.card.unmarkedLeft", { count: card.unmarked })}</p>
      )}

      {action && (
        <Link href={action.href}
              className={cn(buttonVariants({ variant: action.primary ? "primary" : "secondary", size: "lg" }), "mt-4 w-full")}>
          {action.label}
        </Link>
      )}
      {!cancelled && !card.can_run && (
        <Link href={detailsHref} className={cn(buttonVariants({ variant: "ghost", size: "md" }), "mt-3 w-full")}>
          {t("coachTrainings.card.details")} <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </article>
  );
}

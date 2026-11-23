import Link from "next/link";
import { CalendarClock, ChevronRight, MapPin, UserRound, Users } from "lucide-react";
import { Badge, buttonVariants } from "@/components/ui";
import type { BookedSessionInfo } from "@/lib/booking/portal";
import { placesTaken } from "@/lib/booking/portal";
import type { Formatter } from "@/lib/format";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";

/*
 * Coach portal pieces for booked training sessions (server components). They
 * only render what coach_booking_agenda returns: service, time, place and the
 * participants' names. No price, payer or invoice data reaches the coach.
 */

export function sessionKindLabel(kind: string, t: Translator): string {
  return t.dynamic(`bookingPortal.kind.${kind}`, undefined, t("bookingPortal.bookedSession"));
}

/** Kind badge + roster names + places, shown inside a training card. */
export function BookedSessionDetails({ session, t, f }: { session: BookedSessionInfo; t: Translator; f: Formatter }) {
  const places = placesTaken(session);
  const names = session.participants.map((p) => p.name);
  return (
    <div className="mt-3 space-y-1.5 text-sm text-text-secondary">
      <p className="flex flex-wrap items-center gap-1.5">
        <Badge tone="accent">{sessionKindLabel(session.kind, t)}</Badge>
        {places.capacity > 1 && (
          <Badge tone={places.full ? "warning" : "neutral"}>
            {t("bookingPortal.coach.places", { taken: places.taken, capacity: places.capacity })}
          </Badge>
        )}
        {session.venueSpace && <span className="text-xs text-text-muted">{session.venueSpace}</span>}
      </p>
      <p className="flex items-start gap-2">
        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <span className="min-w-0 break-words">
          {names.length ? t("bookingPortal.coach.participants", { names: names.join(", ") }) : t("bookingPortal.coach.noParticipants")}
        </span>
      </p>
      {session.rescheduledFrom && session.status !== "cancelled" && (
        <p className="text-xs text-warning">{t("bookingPortal.movedFrom", { when: f.dateTime(session.rescheduledFrom, "medium") })}</p>
      )}
    </div>
  );
}

/** A booked session without a training card (e.g. no calendar event yet): same look, read-only. */
export function BookedSessionCard({ session, t, f, showDate }: { session: BookedSessionInfo; t: Translator; f: Formatter; showDate?: boolean }) {
  const cancelled = session.status === "cancelled";
  const href = session.eventId ? `/coach/trainings/${session.eventId}` : null;
  return (
    <article className={cn("rounded-lg border bg-surface p-4", cancelled ? "border-border opacity-80" : "border-border-strong")}
             aria-labelledby={`session-${session.sessionId}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`session-${session.sessionId}`} className="font-display text-lg leading-tight text-text">
            {href ? <Link href={href} className="hover:underline focus-visible:outline-none focus-visible:shadow-focus">{session.serviceName}</Link>
              : session.serviceName}
          </h3>
          <p className="mt-0.5 text-xs text-text-muted">{t("bookingPortal.bookedSession")}</p>
        </div>
        {cancelled && <Badge tone="danger">{t("coachTrainings.card.cancelled")}</Badge>}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-1.5 text-sm text-text-secondary sm:grid-cols-2">
        <li className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          <span>{showDate && <>{f.date(session.startsAt, { weekday: true })} · </>}{f.time(session.startsAt)}–{f.time(session.endsAt)}</span>
        </li>
        {session.location && (
          <li className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-text-muted" aria-hidden /><span className="truncate">{session.location}</span></li>
        )}
        <li className="flex items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />{t("coachTrainings.card.rosterSize", { count: session.participantsCount })}
        </li>
      </ul>
      <BookedSessionDetails session={session} t={t} f={f} />
      {href && !cancelled && (
        <Link href={`${href}/attendance`} className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "mt-4 w-full")}>
          {t("coachTrainings.card.take")} <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </article>
  );
}

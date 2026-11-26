import { CalendarClock, Hourglass, MapPin } from "lucide-react";
import { Badge } from "@/components/ui";
import { RequestDecision } from "@/components/booking/request-decision";
import { sortRequests } from "@/lib/booking/portal";
import type { CoachBookingRequest } from "@/lib/booking/types";
import type { Formatter } from "@/lib/format";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";

/*
 * Coach portal: booking requests waiting for this coach (held places outside
 * the declared availability, or family requests). Names, service, time and
 * place only (coach_booking_requests): no payer, price or notes. Confirm /
 * decline (reason required) through the request RPCs.
 */
export function CoachBookingRequests({ rows, t, f }: { rows: CoachBookingRequest[]; t: Translator; f: Formatter }) {
  if (rows.length === 0) return null;
  return (
    <section id="booking-requests" aria-labelledby="requests-h" className="scroll-mt-20 space-y-2">
      <h2 id="requests-h" className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-brand-accent">
        {t("bookingRequests.coachTitle")} <Badge tone="accent">{f.number(rows.length)}</Badge>
      </h2>
      <p className="text-sm text-text-muted">{t("bookingRequests.coachHint")}</p>
      <ul className="space-y-2">
        {sortRequests(rows).map((r) => (
          <li key={r.booking_id}>
            <article aria-labelledby={`req-${r.booking_id}`}
                     className={cn("rounded-lg border border-dashed bg-surface p-4", r.stale ? "border-warning" : "border-brand-accent/60")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 id={`req-${r.booking_id}`} className="font-medium text-text">{r.service_name}</h3>
                  <p className="text-sm text-text-secondary">{r.athlete_first_name} {r.athlete_last_name}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="neutral">{t.dynamic(`bookingRequests.sourceKind.${r.source ?? "staff"}`, undefined, r.source ?? "")}</Badge>
                  {r.stale && <Badge tone="warning"><Hourglass className="h-3 w-3" aria-hidden /> {t("bookingRequests.stale")}</Badge>}
                </div>
              </div>
              <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                <li className="flex items-center gap-2"><CalendarClock className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                  {f.date(r.starts_at, { weekday: true })} · {f.time(r.starts_at)}{r.ends_at ? `–${f.time(r.ends_at)}` : ""}</li>
                {r.location && <li className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />{r.location}</li>}
                {r.capacity && r.capacity > 1 && <li className="text-xs text-text-muted">{t("bookingPortal.coach.places", { taken: r.participants_count, capacity: r.capacity })}</li>}
                {r.requested_at && <li className="text-xs text-text-muted">{t("bookingRequests.requestedOn", { when: f.dateTime(r.requested_at, "medium") })}</li>}
              </ul>
              <div className="mt-3"><RequestDecision bookingId={r.booking_id} compact /></div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

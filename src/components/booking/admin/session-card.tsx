import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { LIVE_BOOKING, type SessionEventInfo } from "@/lib/booking/admin-data";
import { stateTone } from "./tones";

/**
 * A booking session on the calendar (event with training_session_id): its
 * participants (bookings) with links, remaining capacity, and the note that
 * the event is managed by its bookings (moved / cancelled through them).
 */
export async function SessionBookingsCard({ info }: { info: SessionEventInfo }) {
  const { t } = await getI18n();
  const live = info.participants.filter((p) => LIVE_BOOKING.includes(p.status));
  const left = Math.max(0, info.capacity - live.length);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("adminBooking.session.title")}</CardTitle>
        <span className="text-xs text-ink-3 tnum">{t("adminBooking.form.placesLeft", { count: left, capacity: info.capacity })}</span>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="flex items-start gap-2 rounded border border-info/30 bg-info-soft p-2 text-sm text-info">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" /> {t("adminBooking.session.managed")}
        </p>
        <p className="text-sm text-ink-2">{[info.serviceName, info.coachName].filter(Boolean).join(" · ")}</p>
        {info.participants.length === 0 ? <p className="text-sm text-ink-3">{t("adminBooking.session.empty")}</p> : (
          <ul className="space-y-1">
            {info.participants.map((p) => {
              const state = p.status === "booked" ? "confirmed" : p.status;
              return (
                <li key={p.bookingId} className="flex items-center justify-between gap-2 border-b border-line-soft pb-1.5 text-sm last:border-0">
                  <span className="min-w-0">
                    <Link href={`/admin/bookings/${p.bookingId}`} className="text-ink hover:text-maroon">{p.name}</Link>{" "}
                    <Link href={`/admin/athletes/${p.athleteId}?tab=bookings`} className="text-xs text-ink-3 hover:text-maroon">{t("adminBooking.session.profile")}</Link>
                  </span>
                  <Badge tone={stateTone(state)}>{t.dynamic(`bookingWorkflow.state.${state}`, undefined, state)}</Badge>
                </li>
              );
            })}
          </ul>
        )}
        {info.status === "scheduled" && left > 0 && (
          <Link href="/admin/bookings/new"><Button size="sm" variant="secondary"><Plus className="h-4 w-4" /> {t("adminBooking.session.addParticipant")}</Button></Link>
        )}
      </CardBody>
    </Card>
  );
}

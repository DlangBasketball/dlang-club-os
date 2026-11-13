import Link from "next/link";
import { CalendarPlus, Dumbbell, MapPin } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, StatCard, StatGrid, statusTone } from "@/components/ui";
import { MarkSessionButtons, TrainingProfileEditor } from "./admin-widgets";
import type { AthleteTraining } from "@/lib/training/data";
import { getI18n } from "@/lib/i18n/server";

/**
 * Athlete training profile: goals / notes, credits by service, history with
 * attended / no-show. Admin and the athlete's coaches edit; parents read.
 */
export async function AthleteTrainingView({ data, canEdit, canMark, bookHref, bookingHref }: {
  data: AthleteTraining; canEdit: boolean; canMark: boolean; bookHref?: string; bookingHref?: (id: string) => string | null;
}) {
  const { t, f } = await getI18n();
  const now = Date.now();
  const upcoming = data.bookings.filter((b) => b.status === "booked" && Date.parse(b.start) >= now).reverse();
  const past = data.bookings.filter((b) => !(b.status === "booked" && Date.parse(b.start) >= now));

  const Row = ({ b }: { b: AthleteTraining["bookings"][number] }) => {
    const href = bookingHref?.(b.id) ?? null;
    const title = <span className="font-medium text-ink">{b.serviceName}</span>;
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
        <div className="min-w-0">
          {href ? <Link href={href} className="hover:text-maroon">{title}</Link> : title}
          <div className="text-xs text-ink-3">{f.date(b.start, { weekday: true })} · {f.time(b.start)} · {b.coachName}</div>
          {(b.venueName || b.locationText) && <div className="flex items-center gap-1 text-[11px] text-ink-4"><MapPin className="h-3 w-3" />{b.locationText || b.venueName}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {b.sessionType === "group" && b.status === "booked" && !b.groupConfirmed && <Badge tone="warning">{t("training.profile.groupWaiting")}</Badge>}
          {b.creditsUsed > 0 ? <span className="text-xs text-ink-3">{t("training.profile.paidCredits", { count: b.creditsUsed })}</span> : b.price ? <span className="tnum text-xs text-ink-3">{f.money(b.price)}</span> : null}
          <Badge tone={statusTone(b.status)}>{t.dynamic(`training.bookingStatus.${b.status}`, undefined, b.status)}</Badge>
          {canMark && Date.parse(b.start) <= now + 864e5 && <MarkSessionButtons bookingId={b.id} status={b.status} />}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <StatGrid>
        <StatCard label={t("training.profile.upcoming")} value={String(data.stats.upcoming)} />
        <StatCard label={t("training.profile.attended")} value={String(data.stats.attended)} tone="success" />
        <StatCard label={t("training.profile.noShow")} value={String(data.stats.noShow)} tone="warning" />
        <StatCard label={t("training.profile.cancelled")} value={String(data.stats.cancelled)} />
      </StatGrid>

      <Card>
        <CardHeader><CardTitle>{t("training.profile.creditsTitle")}</CardTitle></CardHeader>
        <CardBody>
          {data.balances.length === 0 ? <p className="text-sm text-ink-3">{t("training.profile.noCredits")}</p> : (
            <ul className="space-y-1 text-sm">
              {data.balances.map((b) => (
                <li key={b.serviceId} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink">{b.serviceName}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={b.remaining > 0 ? "success" : "neutral"}>{t("training.common.sessionsLeft", { count: b.remaining })}</Badge>
                    {b.pending > 0 && <Badge tone="warning">{t("training.profile.pending", { count: b.pending })}</Badge>}
                    {b.nextExpiry && <span className="text-xs text-ink-4">{t("training.common.expires", { date: f.date(b.nextExpiry) })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {bookHref && <Link href={bookHref} className="mt-3 inline-block"><Button size="sm"><CalendarPlus className="h-4 w-4" /> {t("training.profile.book")}</Button></Link>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("training.profile.title")}</CardTitle></CardHeader>
        <CardBody><TrainingProfileEditor athleteId={data.athlete.id} profile={data.profile} canEdit={canEdit} /></CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("training.profile.history")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {data.bookings.length === 0 && <EmptyState icon={<Dumbbell className="h-5 w-5" />} title={t("training.profile.noBookings")} />}
          {upcoming.length > 0 && <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-4">{t("training.profile.upcoming")}</h3><ul className="space-y-1">{upcoming.map((b) => <Row key={b.id} b={b} />)}</ul></section>}
          {past.length > 0 && <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-4">{t("training.profile.past")}</h3><ul className="space-y-1">{past.map((b) => <Row key={b.id} b={b} />)}</ul></section>}
        </CardBody>
      </Card>
    </div>
  );
}

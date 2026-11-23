import Link from "next/link";
import { CalendarClock, ChevronRight, ClipboardList } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader, buttonVariants } from "@/components/ui";
import { TrainingCardView, eventTypeLabel } from "@/components/attendance/coach/training-card";
import { BookedSessionCard } from "@/components/booking/portal/coach-session";
import { getTrainingCards, type TrainingCard } from "@/lib/attendance/coach-data";
import { getCoachAgenda } from "@/lib/booking/data";
import { mergeCoachTrainings, type CoachListEntry } from "@/lib/booking/portal";
import { getAwaitingSessions } from "@/lib/attendance/data";
import { getSessionUser } from "@/lib/auth/get-user";
import { zonedWallTimeToUtc } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { addDayKey, zonedDayKey } from "@/lib/staff/hours";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const DAYS_AHEAD = 7;

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("coachTrainings.title") };
}

/**
 * Coach "Today's trainings": today's sessions (team coach + approved
 * substitute + pending requests + booked private / group sessions the coach
 * leads), the next days, and ended sessions still awaiting attendance for
 * this coach. Booked sessions come from coach_booking_agenda (service, time,
 * place, participants' names; never price, payer or invoice). Mobile first.
 */
export default async function CoachTrainingsPage() {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  if (!me?.orgId) return null;
  const tz = f.timeZone;
  const today = zonedDayKey(new Date(), tz);
  const from = zonedWallTimeToUtc(today, "00:00", tz) ?? new Date();
  const to = zonedWallTimeToUtc(addDayKey(today, DAYS_AHEAD + 1), "00:00", tz) ?? new Date(Date.now() + (DAYS_AHEAD + 1) * 86400000);
  const [cards, awaiting, agenda] = await Promise.all([
    getTrainingCards({ from: from.toISOString(), to: to.toISOString() }),
    getAwaitingSessions({ limit: 50 }),
    // Not every coach leads booked sessions: a refusal (no coach profile) just means none.
    getCoachAgenda({ from: from.toISOString(), to: to.toISOString() }),
  ]);

  const list = mergeCoachTrainings(cards.data ?? [], agenda.data ?? []);
  const todays = list.filter((c) => zonedDayKey(c.startsAt, tz) === today);
  const byDay = new Map<string, CoachListEntry<TrainingCard>[]>();
  for (const c of list) {
    const d = zonedDayKey(c.startsAt, tz);
    if (d === today) continue;
    byDay.set(d, [...(byDay.get(d) ?? []), c]);
  }
  const todayIds = new Set(todays.flatMap((c) => (c.type === "card" ? [c.card.event_id] : c.session.eventId ? [c.session.eventId] : [])));
  const entry = (c: CoachListEntry<TrainingCard>) => c.type === "card"
    ? <TrainingCardView key={c.card.event_id} card={c.card} session={c.session} t={t} f={f} />
    : <BookedSessionCard key={`s-${c.session.sessionId}`} session={c.session} t={t} f={f} />;
  const overdue = (awaiting.data ?? []).filter((a) => !todayIds.has(a.event_id));

  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("coachTrainings.title")} description={t("coachTrainings.description")}
                  actions={
                    <Link href="/coach/attendance/corrections" className={buttonVariants({ variant: "secondary", size: "md" })}>
                      <ClipboardList className="h-4 w-4" aria-hidden /> {t("coachTrainings.corrections.link")}
                    </Link>
                  } />

      {cards.error && (
        <ErrorState title={t("coachTrainings.loadError")} message={t("coachTrainings.loadErrorHint")}
                    action={<Link href="/coach/trainings" className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("coachTrainings.retry")}</Link>} />
      )}

      {overdue.length > 0 && (
        <section aria-labelledby="awaiting-h" className="space-y-2">
          <h2 id="awaiting-h" className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-warning">
            {t("coachTrainings.awaitingTitle")} <Badge tone="warning">{f.number(overdue.length)}</Badge>
          </h2>
          <p className="text-sm text-text-muted">{t("coachTrainings.awaitingHint")}</p>
          <ul className="space-y-2">
            {overdue.map((a) => (
              <li key={a.event_id}>
                <Link href={`/coach/trainings/${a.event_id}/attendance`}
                      className={cn("flex min-h-[64px] items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft p-3",
                                    "focus-visible:outline-none focus-visible:shadow-focus hover:border-warning")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-text">{a.team_name} · {eventTypeLabel(a.event_type, t)}</p>
                    <p className="text-sm text-text-secondary">
                      {f.date(a.starts_at, { weekday: true })} · {f.time(a.starts_at)}
                      {" · "}{t("coachTrainings.awaitingDays", { count: Math.max(0, a.days_since_end) })}
                    </p>
                    <p className="text-xs text-text-muted">
                      {a.sheet_status ? t(`teamAttendance.sheetStatuses.${a.sheet_status}`) : t("coachTrainings.card.notStarted")}
                      {a.sheet_status && a.unmarked > 0 && <> · {t("coachTrainings.card.unmarkedLeft", { count: a.unmarked })}</>}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-sm font-medium text-brand-primary">
                    {t("coachTrainings.card.take")} <ChevronRight className="h-4 w-4" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="today-h" className="space-y-3">
        <h2 id="today-h" className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {t("coachTrainings.today")} · {f.date(today, { weekday: true })}
        </h2>
        {!cards.error && todays.length === 0
          ? <EmptyState icon={<CalendarClock />} title={t("coachTrainings.noToday")} description={t("coachTrainings.noTodayHint")} />
          : todays.map(entry)}
      </section>

      <section aria-labelledby="next-h" className="space-y-3">
        <h2 id="next-h" className="text-xs font-medium uppercase tracking-wide text-text-muted">{t("coachTrainings.upcoming")}</h2>
        {!cards.error && byDay.size === 0 && <p className="text-sm text-text-muted">{t("coachTrainings.noUpcoming")}</p>}
        {Array.from(byDay.entries()).map(([day, items]) => (
          <div key={day} className="space-y-2">
            <h3 className="text-sm font-medium text-text-secondary">{f.date(day, { weekday: true })}</h3>
            {items.map(entry)}
          </div>
        ))}
      </section>
    </div>
  );
}

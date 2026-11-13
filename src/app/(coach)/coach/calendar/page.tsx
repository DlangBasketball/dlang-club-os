import { PageHeader, ErrorState } from "@/components/ui";
import { CalendarBody, CalendarFilters, CalendarToolbar } from "@/components/calendar/calendar-view";
import { FeedLink } from "@/components/calendar/feed-link";
import { loadCalendarPage, type CalendarSearchParams } from "@/lib/calendar/page";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.calendar.title") };
}

const BASE = "/coach/calendar";

export default async function CoachCalendarPage({ searchParams }: { searchParams: Promise<CalendarSearchParams> }) {
  const page = await loadCalendarPage("coach", await searchParams, "week");
  if (!page) return null;
  const { t, f, q, from, to, items, error, firstDow, hasFeed } = page;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("staff.calendar.title")} description={t("staff.calendar.coachDescription")} />
      <CalendarToolbar basePath={BASE} q={q} from={from} to={to} f={f} t={t} />
      <CalendarFilters q={q} t={t} options={{ kinds: ["team_event", "session", "booking", "shift", "club_event"] }} />
      {error ? <ErrorState title={error} /> : <CalendarBody items={items} q={q} from={from} to={to} basePath={BASE} f={f} t={t} firstDow={firstDow} />}
      <FeedLink active={hasFeed} />
    </div>
  );
}

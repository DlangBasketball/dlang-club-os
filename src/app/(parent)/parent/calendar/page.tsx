import { PageHeader, ErrorState, Card, CardHeader, CardTitle, CardBody } from "@/components/ui";
import { CalendarBody, CalendarFilters, CalendarToolbar } from "@/components/calendar/calendar-view";
import { FeedLink } from "@/components/calendar/feed-link";
import { LessonPlanReadOnly } from "@/components/staff/lesson-plan";
import { loadCalendarPage, type CalendarSearchParams } from "@/lib/calendar/page";
import { getI18n } from "@/lib/i18n/server";
import { lessonPlanAttachmentUrls, lessonPlansFor } from "@/lib/staff/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.calendar.title") };
}

const BASE = "/parent/calendar";

export default async function ParentCalendarPage({ searchParams }: { searchParams: Promise<CalendarSearchParams> }) {
  const page = await loadCalendarPage("parent", await searchParams, "month");
  if (!page) return null;
  const { t, f, q, from, to, items, error, firstDow, hasFeed, orgId } = page;
  // Lesson plans coaches shared for the children's sessions / events in view.
  const plans = await lessonPlansFor(orgId, {
    sessionIds: items.filter((i) => i.kind === "session").map((i) => i.sourceId),
    eventIds: items.filter((i) => i.kind === "team_event").map((i) => i.sourceId),
  });
  const shared = items.filter((i) => plans.get(i.sourceId)?.sharedWithParents);
  const urls = await lessonPlanAttachmentUrls(shared.map((i) => plans.get(i.sourceId)?.attachmentPath));
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("staff.calendar.title")} description={t("staff.calendar.parentDescription")} />
      <CalendarToolbar basePath={BASE} q={q} from={from} to={to} f={f} t={t} />
      <CalendarFilters q={q} t={t} options={{ kinds: ["team_event", "session", "camp", "booking", "club_event"] }} />
      {error ? <ErrorState title={error} /> : <CalendarBody items={items} q={q} from={from} to={to} basePath={BASE} f={f} t={t} firstDow={firstDow} />}
      {shared.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("staff.lessonPlans.sharedTitle")}</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            {shared.map((i) => {
              const plan = plans.get(i.sourceId)!;
              return (
                <details key={i.id} className="rounded border border-border-soft p-3">
                  <summary className="cursor-pointer text-sm text-text">
                    <span className="font-medium">{i.title}</span> <span className="text-text-muted">· {f.date(i.start, { weekday: true })}</span>
                  </summary>
                  <div className="mt-2">
                    <LessonPlanReadOnly plan={plan} attachmentUrl={plan.attachmentPath ? urls.get(plan.attachmentPath) ?? null : null} />
                  </div>
                </details>
              );
            })}
          </CardBody>
        </Card>
      )}
      <FeedLink active={hasFeed} />
    </div>
  );
}

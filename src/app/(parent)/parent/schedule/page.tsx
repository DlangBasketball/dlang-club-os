import { CalendarDays } from "lucide-react";
import { EventCancelNote, EventPlaceView } from "@/components/schedule/event-place";
import { PageHeader, Card, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { RsvpButtons } from "@/components/schedule/event-controls";
import { getChildrenSchedule } from "@/lib/sportsops/data";
import { eventTitle, eventTone, eventTypeLabel } from "@/lib/sportsops/labels";
import { dayKey, fmtDayKey, fmtTime } from "@/lib/sportsops/time";
import { LessonPlanReadOnly } from "@/components/staff/lesson-plan";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { lessonPlanAttachmentUrls, lessonPlansFor, type LessonPlanView } from "@/lib/staff/data";

export const metadata = { title: "Schedule" };

export default async function ParentSchedulePage() {
  const res = await getChildrenSchedule();
  if (res.error !== null) return <div className="animate-fade-up"><PageHeader title="Schedule" /><ErrorState message={res.error} /></div>;
  const { events, hasTeams } = res.data;
  // Lesson plans the coaches shared with parents (RLS: own children's events only).
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  const plans: Map<string, LessonPlanView> = me?.orgId ? await lessonPlansFor(me.orgId, { eventIds: events.map((e) => e.id) }) : new Map();
  const planUrls = await lessonPlanAttachmentUrls(Array.from(plans.values()).map((p) => p.attachmentPath));
  const needsReply = events.filter((e) => e.status === "scheduled" && e.children.some((c) => !c.rsvp)).length;

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Schedule" description={needsReply ? `${needsReply} upcoming event${needsReply === 1 ? "" : "s"} waiting for your reply.` : "Upcoming trainings and games for your children."} />
      {events.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-5 w-5" />} title={hasTeams ? "Nothing scheduled yet" : "No team yet"}
          description={hasTeams ? "New trainings and games will appear here." : "Once your child is placed on a team, their schedule appears here."} />
      ) : (
        <div className="space-y-3">
          {events.map((e) => {
            const closed = e.status === "cancelled" || e.status === "completed";
            return (
              <Card key={e.id} className={e.status === "cancelled" ? "opacity-60" : undefined} style={e.teamColor ? { borderLeft: `3px solid ${e.teamColor}` } : undefined}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{fmtDayKey(dayKey(e.startsAt))} · {fmtTime(e.startsAt)}–{fmtTime(e.endsAt)}</div>
                      <div className="mt-0.5 font-semibold text-ink">{eventTitle({ ...e, home_away: e.homeAway })}</div>
                      <div className="mt-0.5 text-xs text-ink-3"><EventPlaceView e={e} withMap /></div>
                    </div>
                    <div className="flex gap-1.5">
                      <Badge tone={eventTone(e.type)}>{eventTypeLabel(e.type)}</Badge>
                      {e.status !== "scheduled" && <Badge tone={e.status === "cancelled" ? "danger" : "warning"}>{e.status}</Badge>}
                    </div>
                  </div>
                  {e.status === "cancelled" && <EventCancelNote reason={e.cancelReason} />}
                  {e.notes && <p className="whitespace-pre-wrap text-sm text-ink-2">{e.notes}</p>}
                  {(() => {
                    const plan = plans.get(e.id);
                    if (!plan?.sharedWithParents) return null;
                    return (
                      <details className="rounded border border-line-soft p-3">
                        <summary className="cursor-pointer text-sm font-medium text-ink">{t("staff.lessonPlans.sharedPlan")}</summary>
                        <div className="mt-2">
                          <LessonPlanReadOnly plan={plan} attachmentUrl={plan.attachmentPath ? planUrls.get(plan.attachmentPath) ?? null : null} />
                        </div>
                      </details>
                    );
                  })()}
                  {!closed && (
                    <div className="space-y-2 border-t border-line-soft pt-3">
                      {e.children.map((c) => <RsvpButtons key={c.athleteId} eventId={e.id} athleteId={c.athleteId} current={c.rsvp} label={c.name} />)}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

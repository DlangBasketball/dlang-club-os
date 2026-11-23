import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarX2 } from "lucide-react";
import { EmptyState, ErrorState, buttonVariants } from "@/components/ui";
import { CoachAttendanceSheet } from "@/components/attendance/coach/attendance-sheet";
import { FinalAttendanceSheet } from "@/components/attendance/coach/final-sheet";
import { RequestAccessPanel } from "@/components/attendance/coach/request-access";
import { SessionHeader } from "@/components/attendance/coach/session-header";
import { openAttendance } from "@/lib/actions/team-attendance";
import { getCoachOptions, getEventSummary, getMySessionAccess } from "@/lib/attendance/coach-data";
import { getAttendanceSheet } from "@/lib/attendance/data";
import { uuidSchema, type AttendanceSheet } from "@/lib/attendance/types";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("coachTrainings.sheet.title") };
}

/**
 * Take attendance: opens (creates) the sheet right away with the roster of
 * the session date + guests. Final sheets are read-only with corrections;
 * coaches without access can request it; cancelled sessions take no sheet.
 */
export default async function TakeAttendancePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!uuidSchema.safeParse(eventId).success) notFound();
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  if (!me?.orgId) return null;

  const opened = await openAttendance(eventId);
  let sheet: AttendanceSheet | null = opened.ok && opened.data ? (opened.data as unknown as AttendanceSheet) : null;
  const code = opened.ok ? null : opened.code ?? null;

  if (!sheet && code === "NOT_AUTHORIZED") {
    const [ev, access] = await Promise.all([getEventSummary(eventId), getMySessionAccess(eventId)]);
    if (!ev) notFound();
    return (
      <div className="mx-auto max-w-3xl">
        <SessionHeader t={t} f={f} teamName={ev.teamName} title={ev.title} type={ev.type} startsAt={ev.startsAt} endsAt={ev.endsAt}
                       cancelled={ev.status === "cancelled"} />
        <RequestAccessPanel eventId={eventId} access={access} cancelled={ev.status === "cancelled"} />
      </div>
    );
  }
  if (!sheet && code === "EVENT_CANCELLED") {
    const read = await getAttendanceSheet(eventId);
    sheet = read.data;
  }
  if (!sheet) {
    if (code === "EVENT_NOT_FOUND") notFound();
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState title={t("coachTrainings.sheet.loadError")} message={opened.ok ? undefined : opened.error}
                    action={<Link href="/coach/trainings" className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("coachTrainings.backToList")}</Link>} />
      </div>
    );
  }

  const ev = sheet.event;
  const cancelled = ev.status === "cancelled";
  const final = sheet.sheet?.status === "final";
  const header = (
    <SessionHeader t={t} f={f} teamName={ev.team_name} title={ev.title} type={ev.type} startsAt={ev.starts_at} endsAt={ev.ends_at}
                   location={ev.location_name} cancelled={cancelled} sheetStatus={sheet.sheet?.status ?? null}
                   substitute={sheet.access.is_substitute}
                   links={<Link href={`/coach/trainings/${eventId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("coachTrainings.sheet.details")}</Link>} />
  );

  if (cancelled) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <EmptyState icon={<CalendarX2 />} title={t("coachTrainings.cancelled.title")}
                    description={ev.cancel_reason ? t("coachTrainings.card.cancelledReason", { reason: ev.cancel_reason }) : t("coachTrainings.cancelled.body")} />
      </div>
    );
  }

  if (final) {
    const s = sheet.sheet!;
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <p className="mb-3 text-sm text-text-secondary">
          {s.finalized_at && t("coachTrainings.final.finalizedAt", { when: f.dateTime(s.finalized_at, "short") })}
          {s.led_by_name && <> · {t("coachTrainings.final.ledBy", { name: s.led_by_name })}</>}
        </p>
        <FinalAttendanceSheet eventId={eventId} sheet={sheet} userId={me.id} />
      </div>
    );
  }

  const { coaches, myCoachId } = await getCoachOptions(me.id);
  return (
    <div className="mx-auto max-w-3xl">
      {header}
      {sheet.sheet?.status === "reopened" && (
        <p className="mb-3 rounded-md border border-info/30 bg-info-soft p-3 text-sm text-text">{t("coachTrainings.sheet.reopened")}</p>
      )}
      {!ev.ended && <p className="mb-3 text-xs text-text-muted">{t("coachTrainings.sheet.notEnded")}</p>}
      <CoachAttendanceSheet eventId={eventId} initialSheet={sheet} coaches={coaches} myCoachId={myCoachId} userId={me.id} />
    </div>
  );
}

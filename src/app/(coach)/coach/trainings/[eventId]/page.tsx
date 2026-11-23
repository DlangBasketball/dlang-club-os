import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, buttonVariants } from "@/components/ui";
import { AcknowledgeAbsenceButton } from "@/components/attendance/coach/acknowledge-absence";
import { CorrectionRequestList, type CorrectionRequestRow } from "@/components/attendance/coach/correction-requests";
import { RequestAccessPanel } from "@/components/attendance/coach/request-access";
import { SessionHeader } from "@/components/attendance/coach/session-header";
import { STATUS_TONE } from "@/components/attendance/coach/status-picker";
import { getEventSummary, getMySessionAccess, getSheetHistory, type HistoryChange } from "@/lib/attendance/coach-data";
import { getAttendanceSheet, getCorrectionRequests } from "@/lib/attendance/data";
import { uuidSchema, type FinalStatus, type MarkStatus } from "@/lib/attendance/types";
import type { Formatter } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("coachTrainings.details.title") };
}

function StatusPill({ status, t }: { status: MarkStatus; t: Translator }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                        status === "unmarked" ? "border-border text-text-muted" : STATUS_TONE[status as FinalStatus])}>
      {t(`teamAttendance.statuses.${status}`)}
    </span>
  );
}

function ChangeLine({ c, t, f, withReason }: { c: HistoryChange; t: Translator; f: Formatter; withReason?: boolean }) {
  return (
    <li className="rounded-md border border-border bg-surface-elevated p-2.5 text-sm">
      <p className="flex flex-wrap items-center gap-1.5 text-text">
        <span className="font-medium">{c.first_name} {c.last_name}</span>
        <span className="text-text-muted">·</span>
        {c.previous_status && <StatusPill status={c.previous_status} t={t} />}
        <span aria-hidden className="text-text-muted">→</span>
        <span className="sr-only">{t("coachTrainings.details.to")}</span>
        <StatusPill status={c.new_status} t={t} />
      </p>
      <p className="mt-1 text-xs text-text-muted">
        {t("coachTrainings.details.changedBy", { name: c.changed_by_name ?? t("coachTrainings.common.someone"), when: f.dateTime(c.changed_at, "short") })}
        {" · "}{t(`coachTrainings.details.phases.${c.phase}`)}
      </p>
      {withReason && c.reason && <p className="mt-1 break-words text-text-secondary">{t("coachTrainings.details.reason", { reason: c.reason })}</p>}
    </li>
  );
}

/**
 * Session details for coaches: roster (name, jersey only), reported absences,
 * sheet lifecycle, correction log and the parents' correction requests.
 */
export default async function TrainingDetailsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!uuidSchema.safeParse(eventId).success) notFound();
  const { t, f } = await getI18n();
  const read = await getAttendanceSheet(eventId);

  if (read.error === "NOT_AUTHORIZED") {
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
  if (read.error === "EVENT_NOT_FOUND") notFound();
  if (!read.data) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState title={t("coachTrainings.details.loadError")}
                    message={t.dynamic(`teamAttendance.errors.${read.error}`, undefined, t("teamAttendance.errors.generic"))}
                    action={<Link href="/coach/trainings" className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("coachTrainings.backToList")}</Link>} />
      </div>
    );
  }

  const sheet = read.data;
  const ev = sheet.event;
  const cancelled = ev.status === "cancelled";
  const [history, requests] = await Promise.all([
    getSheetHistory(eventId),
    sheet.access.can_resolve_requests ? getCorrectionRequests({ status: null }) : Promise.resolve({ data: [], error: null }),
  ]);
  const reqRows = ((requests.data ?? []) as CorrectionRequestRow[]).filter((r) => r.event_id === eventId);
  const h = history.data;
  const corrections = (h?.changes ?? []).filter((c) => c.phase === "correction");
  const reports = sheet.marks.filter((m) => m.reported_absence);
  const final = sheet.sheet?.status === "final";
  const actionLabel = final ? t("coachTrainings.card.view") : sheet.sheet ? t("coachTrainings.card.continue") : t("coachTrainings.card.take");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SessionHeader t={t} f={f} teamName={ev.team_name} title={ev.title} type={ev.type} startsAt={ev.starts_at} endsAt={ev.ends_at}
                     location={ev.location_name} cancelled={cancelled} sheetStatus={sheet.sheet?.status ?? null}
                     substitute={sheet.access.is_substitute}
                     links={!cancelled && (
                       <Link href={`/coach/trainings/${eventId}/attendance`} className={buttonVariants({ variant: final ? "secondary" : "primary", size: "lg" })}>
                         {actionLabel}
                       </Link>
                     )} />
      {cancelled && ev.cancel_reason && <p className="text-sm text-text-muted">{t("coachTrainings.card.cancelledReason", { reason: ev.cancel_reason })}</p>}

      <Card>
        <CardHeader><CardTitle>{t("coachTrainings.details.roster")}</CardTitle></CardHeader>
        <CardBody>
          <p className="mb-3 text-xs text-text-muted">
            {t("coachTrainings.details.rosterHint", { date: f.date(sheet.sheet?.roster_date ?? ev.local_date) })}
          </p>
          {sheet.marks.length === 0 ? <p className="text-sm text-text-muted">{t("coachTrainings.sheet.noRoster")}</p> : (
            <ul className="divide-y divide-border">
              {sheet.marks.map((m) => (
                <li key={m.athlete_id} className="flex items-center gap-3 py-2">
                  <span className="w-10 shrink-0 font-mono text-sm text-text-muted">
                    {m.jersey_number !== null ? t("coachTrainings.sheet.jersey", { number: m.jersey_number }) : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{m.first_name} {m.last_name}</span>
                  {m.is_guest && <Badge tone="accent">{t("coachTrainings.sheet.guest")}</Badge>}
                  {sheet.sheet && <StatusPill status={(final ? m.finalized_status : m.status) ?? m.status} t={t} />}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("coachTrainings.details.absences")}</CardTitle></CardHeader>
        <CardBody>
          {reports.length === 0 ? <p className="text-sm text-text-muted">{t("coachTrainings.details.noAbsences")}</p> : (
            <ul className="space-y-2">
              {reports.map((m) => {
                const r = m.reported_absence!;
                const name = `${m.first_name} ${m.last_name}`;
                return (
                  <li key={r.report_id} className="flex items-start gap-3 rounded-md border border-border bg-surface-elevated p-3">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium text-text">{name} · {t(`teamAttendance.absenceCategories.${r.reason_category}`)}</p>
                      {r.reason && <p className="break-words text-text-secondary">{r.reason}</p>}
                      <p className="text-xs text-text-muted">
                        {r.reporter_kind === "player"
                          ? t("coachTrainings.absence.byPlayer", { when: f.dateTime(r.created_at, "short") })
                          : t("coachTrainings.absence.byGuardian", { when: f.dateTime(r.created_at, "short") })}
                      </p>
                      {r.needs_review && <p className="text-xs text-warning">{t("coachTrainings.absence.needsReview")}</p>}
                    </div>
                    {r.status === "acknowledged"
                      ? <Badge tone="success">{t("coachTrainings.absence.acknowledged")}</Badge>
                      : <AcknowledgeAbsenceButton reportId={r.report_id} name={name} />}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("coachTrainings.details.history")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {!h?.sheet ? <p className="text-sm text-text-muted">{t("coachTrainings.details.noSheet")}</p> : (
            <ol className="space-y-1.5 text-sm text-text-secondary">
              <li>{t("coachTrainings.details.opened", { when: f.dateTime(h.sheet.created_at, "short"), name: h.sheet.opened_by_name ?? t("coachTrainings.common.someone") })}</li>
              {h.sheet.first_finalized_at && h.sheet.first_finalized_at !== h.sheet.finalized_at && (
                <li>{t("coachTrainings.details.firstFinal", { when: f.dateTime(h.sheet.first_finalized_at, "short") })}</li>
              )}
              {h.sheet.reopened_at && (
                <li>{t("coachTrainings.details.reopened", { when: f.dateTime(h.sheet.reopened_at, "short"), name: h.sheet.reopened_by_name ?? t("coachTrainings.common.someone"), reason: h.sheet.reopen_reason ?? "" })}</li>
              )}
              {h.sheet.finalized_at && (
                <li>{t("coachTrainings.details.lastFinal", { when: f.dateTime(h.sheet.finalized_at, "short"), name: h.sheet.finalized_by_name ?? t("coachTrainings.common.someone") })}</li>
              )}
              {h.sheet.led_by_name && <li>{t("coachTrainings.final.ledBy", { name: h.sheet.led_by_name })}</li>}
            </ol>
          )}
          {history.error && <p role="alert" className="text-sm text-warning">{t("coachTrainings.details.historyError")}</p>}

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">{t("coachTrainings.details.corrections")}</h3>
            {corrections.length === 0 ? <p className="text-sm text-text-muted">{t("coachTrainings.details.noCorrections")}</p> : (
              <ul className="space-y-2">{corrections.map((c) => <ChangeLine key={c.id} c={c} t={t} f={f} withReason />)}</ul>
            )}
          </div>

          {(h?.changes.length ?? 0) > 0 && (
            <details className="group">
              <summary className="touch-target cursor-pointer text-sm text-brand-primary">
                {t("coachTrainings.details.allChanges", { count: h!.changes.length })}
              </summary>
              <ul className="mt-2 space-y-2">{h!.changes.map((c) => <ChangeLine key={c.id} c={c} t={t} f={f} withReason />)}</ul>
            </details>
          )}
        </CardBody>
      </Card>

      {sheet.access.can_resolve_requests && (
        <Card>
          <CardHeader><CardTitle>{t("coachTrainings.requests.title")}</CardTitle></CardHeader>
          <CardBody><CorrectionRequestList rows={reqRows} canResolve /></CardBody>
        </Card>
      )}
    </div>
  );
}

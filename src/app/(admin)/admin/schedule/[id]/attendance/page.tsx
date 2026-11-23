import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Badge, Card, CardBody, CardHeader, CardTitle, ErrorState } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getEvent, listCoachOptions } from "@/lib/sportsops/data";
import { eventTitle } from "@/lib/sportsops/labels";
import { getSessionAdminDetail } from "@/lib/data/team-attendance-admin";
import { canRetryAlert, coachCoverage, sheetState } from "@/lib/attendance/admin-stats";
import { AdminAttendanceSheet } from "@/components/attendance/admin/admin-sheet";
import {
  AcknowledgeAbsenceButton, AssignCoachForm, DecideAccessButtons, ResolveCorrectionForm, RetryAlertButton,
} from "@/components/attendance/admin/actions";
import { SheetStateBadge } from "@/components/attendance/admin/views";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminAttendance.session.metaTitle") };
}

const ALERT_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  sent: "success", pending: "info", failed: "danger", no_contact: "warning", suppressed: "neutral", superseded: "neutral",
};

/**
 * Admin session page: the sheet (take / correct attendance), who led,
 * submitted and finalized it, every mark change, absence reports, alerts per
 * guardian with delivery status (retry for failed), coach coverage
 * (substitutes, pending access requests) and correction requests.
 */
export default async function SessionAttendancePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const [{ t, f }, ev] = await Promise.all([getI18n(), getEvent(id)]);
  if (ev.error !== null) return <div className="animate-fade-up"><PageHeader title={t("adminAttendance.session.metaTitle")} /><ErrorState message={ev.error} /></div>;
  const e = ev.data;
  if (!e) notFound();
  const [d, coaches] = await Promise.all([getSessionAdminDetail(e.id, e.teamId), listCoachOptions()]);
  const sheet = d.sheet;
  const st = sheetState({ event_status: e.status, sheet_status: sheet?.sheet?.status ?? null, ends_at: e.endsAt });
  const approved = d.assignments.filter((a) => a.status === "approved");
  const coverage = coachCoverage(d.teamCoaches.length, approved.length);
  const mark = (s: string | null) => (s ? t.dynamic(`adminAttendance.mark.${s}`, undefined, s) : "—");
  const meta = d.meta;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={eventTitle({ ...e, home_away: e.homeAway })}
        description={f.dateRange(e.startsAt, e.endsAt)}
        actions={<Link href={`/admin/schedule/${e.id}`} className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> {t("adminAttendance.session.backToEvent")}</Link>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t.dynamic(`adminAttendance.eventType.${e.type}`, undefined, e.type)}</Badge>
        {e.teamId && e.teamName && <Link href={`/admin/teams/${e.teamId}?tab=attendance`}><Badge tone="neutral">{e.teamName}</Badge></Link>}
        <SheetStateBadge state={st} />
        {e.status === "cancelled" && e.cancelReason && <span className="text-sm text-text-muted">{t("adminAttendance.history.cancelReason", { reason: e.cancelReason })}</span>}
        {sheet && !sheet.event.tracked && <Badge tone="warning">{t("adminAttendance.session.notTracked")}</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {sheet ? <AdminAttendanceSheet sheet={sheet} coaches={coaches.data ?? []} /> : (
            <Card><CardBody className="text-sm text-text-muted">
              {t.dynamic(`teamAttendance.errors.${d.sheetError ?? "generic"}`, undefined, t("teamAttendance.errors.generic"))}
            </CardBody></Card>
          )}

          <Card>
            <CardHeader><CardTitle>{t("adminAttendance.session.history")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {d.history.length === 0 ? <p className="px-5 py-5 text-sm text-text-muted">{t("adminAttendance.session.noHistory")}</p> : (
                <ul>
                  {d.history.map((h) => (
                    <li key={h.id} className="flex flex-col gap-0.5 border-b border-border-soft px-5 py-2.5 text-sm last:border-0">
                      <span className="text-text">
                        <span className="font-medium">{h.athleteName}</span>: {mark(h.previous)} → {mark(h.next)}
                        <span className="ml-2 text-xs text-text-muted">{t.dynamic(`adminAttendance.phase.${h.phase}`, undefined, h.phase)}</span>
                      </span>
                      <span className="text-xs text-text-muted">
                        {h.by ?? t("adminAttendance.session.unknownUser")} · {f.dateTime(h.at)}{h.reason ? ` · ${h.reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t("adminAttendance.session.status")}</CardTitle></CardHeader>
            <CardBody className="space-y-1.5 text-sm">
              <Row label={t("adminAttendance.session.ledBy")} value={sheet?.sheet?.led_by_name ?? null} />
              <Row label={t("adminAttendance.session.openedBy")} value={meta?.openedBy ?? null} />
              <Row label={t("adminAttendance.session.submittedBy")} value={meta?.submittedBy ? `${meta.submittedBy}${meta.submittedAt ? ` · ${f.dateTime(meta.submittedAt)}` : ""}` : null} />
              <Row label={t("adminAttendance.session.finalizedBy")} value={meta?.finalizedBy ? `${meta.finalizedBy}${meta.finalizedAt ? ` · ${f.dateTime(meta.finalizedAt)}` : ""}` : null} />
              {meta?.firstFinalizedAt && meta.firstFinalizedAt !== meta.finalizedAt && <Row label={t("adminAttendance.session.firstFinalized")} value={f.dateTime(meta.firstFinalizedAt)} />}
              {meta?.reopenedAt && <Row label={t("adminAttendance.session.reopened")} value={`${meta.reopenedBy ?? ""} · ${f.dateTime(meta.reopenedAt)}${meta.reopenReason ? ` · ${meta.reopenReason}` : ""}`} />}
              {sheet?.sheet && <Row label={t("adminAttendance.session.corrections")} value={f.number(sheet.sheet.correction_count)} />}
              {meta?.legacySessionId && (
                <p className="pt-1 text-xs"><Link href={`/admin/attendance/${meta.legacySessionId}`} className="text-brand-primary hover:underline">{t("adminAttendance.session.legacyLink")}</Link></p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("adminAttendance.session.coaches")}</CardTitle>
              <Badge tone={coverage === "missing" ? "danger" : coverage === "substitute" ? "info" : "success"}>{t.dynamic(`adminAttendance.coverage.${coverage}`, undefined, coverage)}</Badge>
            </CardHeader>
            <CardBody className="space-y-4">
              <ul className="space-y-1 text-sm">
                {d.teamCoaches.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2"><span className="text-text">{c.name}</span><span className="text-xs text-text-muted">{t.dynamic(`coaches.roles.${c.role}`, undefined, c.role)}</span></li>
                ))}
                {d.teamCoaches.length === 0 && <li className="text-warning">{t("adminAttendance.team.noCoach")}</li>}
              </ul>
              {d.assignments.length > 0 && (
                <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
                  {d.assignments.map((a) => (
                    <li key={a.id} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0">
                        <span className="text-text">{a.coachName}</span>
                        <span className="ml-1.5 text-xs text-text-muted">{t.dynamic(`adminAttendance.coverage.role${a.role === "lead" ? "Lead" : "Substitute"}`, undefined, a.role)}</span>
                        <Badge className="ml-1.5" tone={a.status === "approved" ? "success" : a.status === "pending" ? "warning" : "neutral"}>{t.dynamic(`adminAttendance.access.status.${a.status}`, undefined, a.status)}</Badge>
                        {a.requestNote && <span className="block text-xs text-text-muted">“{a.requestNote}”</span>}
                      </span>
                      <DecideAccessButtons assignmentId={a.id} status={a.status} />
                    </li>
                  ))}
                </ul>
              )}
              {e.status !== "cancelled" && <AssignCoachForm eventId={e.id} coaches={coaches.data ?? []} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("adminAttendance.reports.title")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {d.reports.length === 0 ? <p className="px-5 py-4 text-sm text-text-muted">{t("adminAttendance.reports.none")}</p> : (
                <ul>
                  {d.reports.map((r) => (
                    <li key={r.id} className="flex flex-col gap-1 border-b border-border-soft px-5 py-2.5 text-sm last:border-0">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-text">{r.athleteName}</span>
                        <Badge tone={r.status === "reported" ? "warning" : r.status === "acknowledged" ? "success" : "neutral"}>{t.dynamic(`adminAttendance.reports.status.${r.status}`, undefined, r.status)}</Badge>
                      </span>
                      <span className="text-xs text-text-muted">
                        {t.dynamic(`adminAttendance.category.${r.category}`, undefined, r.category)}
                        {r.reason ? ` · ${r.reason}` : ""} · {t.dynamic(`adminAttendance.reports.by.${r.reporterKind}`, undefined, r.reporterKind)}{r.reporter ? ` (${r.reporter})` : ""} · {f.dateTime(r.createdAt)}
                        {r.needsReview && <> · <span className="text-warning">{t("adminAttendance.reports.needsReview")}</span></>}
                      </span>
                      {r.status === "reported" && <span className="self-end"><AcknowledgeAbsenceButton reportId={r.id} /></span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("adminAttendance.alerts.title")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {d.alerts.length === 0 ? <p className="px-5 py-4 text-sm text-text-muted">{t("adminAttendance.alerts.none")}</p> : (
                <ul>
                  {d.alerts.map((a) => (
                    <li key={a.id} className="flex flex-col gap-1 border-b border-border-soft px-5 py-2.5 text-sm last:border-0">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-text">{a.athleteName} → {a.guardian ?? t("adminAttendance.alerts.noGuardian")}</span>
                        <Badge tone={ALERT_TONE[a.status] ?? "neutral"}>{t.dynamic(`adminAttendance.alerts.status.${a.status}`, undefined, a.status)}</Badge>
                      </span>
                      <span className="text-xs text-text-muted">
                        {t.dynamic(`adminAttendance.alerts.kind.${a.kind}`, undefined, a.kind)} · {mark(a.markStatus)} · {t("adminAttendance.alerts.attempts", { count: a.attempts })}
                        {a.sentAt ? ` · ${t("adminAttendance.alerts.sentAt", { date: f.dateTime(a.sentAt) })}` : ""}
                        {a.lastError && a.status === "failed" ? ` · ${a.lastError}` : ""}
                      </span>
                      {canRetryAlert({ status: a.status, guardian_profile_id: a.guardianProfileId }) && <span className="self-end"><RetryAlertButton alertId={a.id} eventId={e.id} /></span>}
                      {a.status === "no_contact" && !a.guardianProfileId && (
                        <Link href={`/admin/athletes/${a.athleteId}`} className="self-end text-xs text-brand-primary hover:underline">{t("adminAttendance.alerts.fixContact")}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("adminAttendance.corrections.title")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {d.corrections.length === 0 ? <p className="px-5 py-4 text-sm text-text-muted">{t("adminAttendance.corrections.none")}</p> : (
                <ul>
                  {d.corrections.map((c) => (
                    <li key={c.id} className="space-y-2 border-b border-border-soft px-5 py-3 text-sm last:border-0">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-text">{c.athleteName}: {mark(c.currentStatus)} → {mark(c.requestedStatus)}</span>
                        <Badge tone={c.status === "open" ? "warning" : c.status === "accepted" ? "success" : "neutral"}>{t.dynamic(`adminAttendance.corrections.status.${c.status}`, undefined, c.status)}</Badge>
                      </span>
                      <p className="text-xs text-text-muted">“{c.message}” · {c.requestedBy ?? ""} · {f.dateTime(c.createdAt)}</p>
                      {c.resolutionNote && <p className="text-xs text-text-muted">{t("adminAttendance.corrections.resolution", { note: c.resolutionNote })}</p>}
                      {c.status === "open" && <ResolveCorrectionForm requestId={c.id} requestedStatus={c.requestedStatus} />}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="text-right text-text">{value ?? "—"}</span>
    </div>
  );
}

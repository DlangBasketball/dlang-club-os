import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, DataTable, EmptyState, PageHeader, StatCard, buttonVariants } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getIncident, incidentFormOptions, listIncidents, type IncidentView } from "@/lib/club-admin/data";
import { incidentStats, severityTone } from "@/lib/club-admin/incidents";
import type { Me } from "@/lib/club-admin/server";
import { ClearanceLink, ClearanceUpload, DeleteIncidentButton, IncidentForm, toLocalInput, type IncidentFormValue } from "./incident-forms";

/**
 * Incident pages shared by the admin, coach and parent apps. Every read is
 * RLS-scoped: admin = the club, coach = athletes they coach, parent = their
 * children. The statistics block shows counts only (no names).
 */
export async function IncidentList({ me, base, canReport, showStats }: { me: Me; base: string; canReport: boolean; showStats: boolean }) {
  const { t, f } = await getI18n();
  const rows = await listIncidents(me.orgId);
  const stats = showStats ? incidentStats(rows) : null;
  const L = (group: string, k: string) => t.dynamic(`clubadmin.incidents.${group}.${k}`, undefined, k);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("clubadmin.incidents.title")} description={t(showStats ? "clubadmin.incidents.description" : "clubadmin.incidents.descriptionShort")}
        actions={canReport ? <Link href={`${base}/new`} className={buttonVariants({ size: "sm" })}>{t("clubadmin.incidents.report")}</Link> : undefined} />
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t("clubadmin.incidents.stats.total")} value={String(stats.total)} />
            <StatCard label={t("clubadmin.incidents.stats.open")} value={String(stats.open)} />
            <StatCard label={t("clubadmin.incidents.stats.serious")} value={String((stats.bySeverity.serious ?? 0) + (stats.bySeverity.critical ?? 0))} />
            <StatCard label={t("clubadmin.incidents.stats.outOfPlay")} value={String(stats.outOfPlay)} />
          </div>
          <Card>
            <CardHeader><CardTitle>{t("clubadmin.incidents.stats.title")}</CardTitle></CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <div><h3 className="mb-1 text-xs uppercase tracking-wider text-ink-3">{t("clubadmin.incidents.bodyPart")}</h3>
                <ul>{stats.byBodyPart.slice(0, 8).map((b) => <li key={b.key} className="flex justify-between"><span>{L("bodyParts", b.key)}</span><span className="tnum">{b.count}</span></li>)}</ul></div>
              <div><h3 className="mb-1 text-xs uppercase tracking-wider text-ink-3">{t("clubadmin.incidents.severity")}</h3>
                <ul>{Object.entries(stats.bySeverity).map(([k, n]) => <li key={k} className="flex justify-between"><span>{L("severities", k)}</span><span className="tnum">{n}</span></li>)}</ul></div>
              <div><h3 className="mb-1 text-xs uppercase tracking-wider text-ink-3">{t("clubadmin.incidents.byMonth")}</h3>
                <ul>{stats.byMonth.slice(-6).map((m) => <li key={m.month} className="flex justify-between"><span>{new Intl.DateTimeFormat(f.locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${m.month}-01T00:00:00Z`))}</span><span className="tnum">{m.count}</span></li>)}</ul></div>
              <p className="text-xs text-ink-3 sm:col-span-3">{t("clubadmin.incidents.stats.hint")}</p>
            </CardBody>
          </Card>
        </>
      )}
      <DataTable caption={t("clubadmin.incidents.title")} rows={rows as (IncidentView & Record<string, unknown>)[]} getRowKey={(r) => r.id}
        empty={<EmptyState title={t("clubadmin.incidents.empty")} />}
        columns={[
          { key: "when", header: t("clubadmin.incidents.occurredAt"), render: (r) => f.dateTime(r.occurred_at) },
          { key: "who", header: t("clubadmin.incidents.athlete"), render: (r) => <Link href={`${base}/${r.id}`} className="text-maroon hover:underline">{r.athleteName}</Link> },
          { key: "part", header: t("clubadmin.incidents.bodyPart"), render: (r) => L("bodyParts", r.body_part) },
          { key: "sev", header: t("clubadmin.incidents.severity"), render: (r) => <Badge tone={severityTone(r.severity)}>{L("severities", r.severity)}</Badge> },
          { key: "rtp", header: t("clubadmin.incidents.returnStatus"), render: (r) => L("returnStatuses", r.return_status) },
          { key: "status", header: t("clubadmin.incidents.status"), render: (r) => <Badge tone={r.status === "open" ? "warning" : "neutral"}>{L("statuses", r.status)}</Badge> },
        ]} />
    </div>
  );
}

const blank = (): IncidentFormValue => ({
  id: null, athleteId: "", occurredAt: "", programId: "", teamId: "", location: "", description: "", bodyPart: "other", severity: "minor",
  firstAidGiven: false, firstAidDetails: "", firstAidBy: "", parentsInformedAt: "", parentsInformedHow: "", referral: "none",
  followUpNotes: "", returnStatus: "not_applicable", clearedOn: "", status: "open",
});

export async function IncidentNew({ me, base }: { me: Me; base: string }) {
  const { t } = await getI18n();
  const opts = await incidentFormOptions(me.orgId);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("clubadmin.incidents.report")} description={t("clubadmin.incidents.reportHint")} />
      <Card><CardBody>
        <IncidentForm initial={blank()} athletes={opts.athletes} programs={opts.programs} teams={opts.teams} canClose={me.roles.includes("admin")} backHref={base} />
      </CardBody></Card>
    </div>
  );
}

export async function IncidentDetail({ me, base, id, editable }: { me: Me; base: string; id: string; editable: boolean }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t, f } = await getI18n();
  const r = await getIncident(me.orgId, id);
  if (!r) notFound();
  const isAdmin = me.roles.includes("admin");
  const canEdit = editable && (isAdmin || r.status === "open");
  const L = (group: string, k: string | null) => (k ? t.dynamic(`clubadmin.incidents.${group}.${k}`, undefined, k) : "—");
  const opts = canEdit ? await incidentFormOptions(me.orgId) : null;
  const value: IncidentFormValue = {
    id: r.id, athleteId: r.athlete_id, occurredAt: toLocalInput(r.occurred_at), programId: r.program_id ?? "", teamId: r.team_id ?? "",
    location: r.location ?? "", description: r.description, bodyPart: r.body_part, severity: r.severity, firstAidGiven: r.first_aid_given,
    firstAidDetails: r.first_aid_details ?? "", firstAidBy: r.first_aid_by ?? "", parentsInformedAt: toLocalInput(r.parents_informed_at),
    parentsInformedHow: r.parents_informed_how ?? "", referral: r.referral, followUpNotes: r.follow_up_notes ?? "",
    returnStatus: r.return_status, clearedOn: r.cleared_on ?? "", status: r.status,
  };
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={`${r.athleteName} · ${f.dateTime(r.occurred_at)}`} description={t("clubadmin.incidents.confidential")}
        actions={<span className="flex items-center gap-2">
          <a href={`${base}/${r.id}/pdf`} className={buttonVariants({ size: "sm", variant: "secondary" })}>{t("clubadmin.incidents.pdf")}</a>
          {isAdmin && editable && <DeleteIncidentButton id={r.id} />}
        </span>} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("clubadmin.incidents.clearanceDocument")}</CardTitle>
          {r.clearance_file_path && <ClearanceLink id={r.id} />}
        </CardHeader>
        <CardBody>
          {r.clearance_file_name ? <p className="text-sm text-ink-2">{r.clearance_file_name}</p> : <p className="text-sm text-ink-3">{t("clubadmin.incidents.noClearance")}</p>}
          {canEdit && <div className="pt-3"><ClearanceUpload id={r.id} /></div>}
        </CardBody>
      </Card>
      {canEdit && opts ? (
        <Card><CardBody>
          <IncidentForm initial={value} athletes={opts.athletes.length ? opts.athletes : [{ id: r.athlete_id, name: r.athleteName }]} programs={opts.programs} teams={opts.teams} canClose={isAdmin} backHref={base} />
        </CardBody></Card>
      ) : (
        <Card><CardBody>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {([
              ["context", [r.programName, r.teamName].filter(Boolean).join(" · ") || "—"],
              ["location", r.location ?? "—"],
              ["bodyPart", L("bodyParts", r.body_part)],
              ["severity", L("severities", r.severity)],
              ["firstAidGiven", r.first_aid_given ? t("common.yes") : t("common.no")],
              ["firstAidBy", r.first_aid_by ?? "—"],
              ["parentsInformedAt", r.parents_informed_at ? f.dateTime(r.parents_informed_at) : "—"],
              ["parentsInformedHow", L("informedHow", r.parents_informed_how)],
              ["referral", L("referrals", r.referral)],
              ["returnStatus", L("returnStatuses", r.return_status)],
              ["clearedOn", r.cleared_on ? f.date(r.cleared_on) : "—"],
              ["status", L("statuses", r.status)],
            ] as const).map(([k, val]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line py-1">
                <dt className="text-ink-3">{t.dynamic(`clubadmin.incidents.${k}`, undefined, k)}</dt><dd className="text-right text-ink">{val}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-4 text-xs uppercase tracking-wider text-ink-3">{t("clubadmin.incidents.description")}</h3>
          <p className="whitespace-pre-wrap text-sm text-ink-2">{r.description}</p>
          {r.first_aid_details && (<><h3 className="mt-4 text-xs uppercase tracking-wider text-ink-3">{t("clubadmin.incidents.firstAidDetails")}</h3>
            <p className="whitespace-pre-wrap text-sm text-ink-2">{r.first_aid_details}</p></>)}
          {r.follow_up_notes && (<><h3 className="mt-4 text-xs uppercase tracking-wider text-ink-3">{t("clubadmin.incidents.followUpNotes")}</h3>
            <p className="whitespace-pre-wrap text-sm text-ink-2">{r.follow_up_notes}</p></>)}
        </CardBody></Card>
      )}
      <Link href={base} className="text-sm text-maroon hover:underline">{t("clubadmin.incidents.back")}</Link>
    </div>
  );
}
